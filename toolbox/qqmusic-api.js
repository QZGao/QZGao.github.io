(function () {
	const axios = require('./axios.min.js');
	const pako = require('./pako.min.js');
	const fs = require('fs');
	const path = require('path');
	const crypto = require('crypto');
	const DESHelper = require('./tripledes.js');
	const { TextDecoder } = require('util');

	// replace uuid dependency with built-in crypto.randomUUID (fallback to custom v4)
	const uuidv4 = crypto.randomUUID
		? () => crypto.randomUUID()
		: () => ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
			(c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
		);

	// --- ENUMS ---

	const QRCodeLoginEvents = {
		DONE: [0, 405],
		SCAN: [66, 408],
		CONF: [67, 404],
		TIMEOUT: [65, null],
		REFUSE: [68, 403],
		OTHER: [null, null],
		getByValue(value) {
			for (const [key, arr] of Object.entries(this)) {
				if (Array.isArray(arr) && arr.includes(value)) return key;
			}
			return 'OTHER';
		}
	};

	const PhoneLoginEvents = {
		SEND: 0,
		CAPTCHA: 20276,
		FREQUENCY: 100001,
		OTHER: null
	};

	const QRLoginType = {
		QQ: 'qq',
		WX: 'wx'
	};

	// --- QR Class ---

	class QR {
		constructor(data, qrType, mimetype, identifier) {
			this.data = data;
			this.qrType = qrType;
			this.mimetype = mimetype;
			this.identifier = identifier;
		}
		save(savePath = '.') {
			if (!this.data) return null;
			if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });
			const ext = this.mimetype === 'image/png' ? '.png' : '.jpg';
			const filePath = path.join(savePath, `${this.qrType}-${uuidv4()}${ext}`);
			fs.writeFileSync(filePath, this.data);
			return filePath;
		}
	}

	// --- Replace error classes with mw.notify + console.log ---

	function notifyError(msg) {
		if (typeof mw !== 'undefined' && mw.notify) {
			mw.notify(msg, { type: 'error' });
		}
		console.log('[ERROR]', msg);
	}

	// --- Utility Functions ---

	/**
	 * hash33 演算法
	 * @param {string} s
	 * @param {number} h (optional, default 0)
	 * @returns {number}
	 */
	function hash33(s, h = 0) {
		for (let i = 0; i < s.length; i++) {
			h = (h << 5) + h + s.charCodeAt(i);
		}
		return 2147483647 & h;
	}

	/**
	 * 產生隨機 guid（32 位元十六進位字元）
	 * @returns {string}
	 */
	function getGuid() {
		const chars = 'abcdef1234567890';
		let guid = '';
		for (let i = 0; i < 32; i++) {
			guid += chars[Math.floor(Math.random() * chars.length)];
		}
		return guid;
	}

	/**
	 * 產生隨機 searchID
	 * @returns {string}
	 */
	function getSearchID() {
		const e = Math.floor(Math.random() * 20) + 1;
		const t = e * 18014398509481984;
		const n = Math.floor(Math.random() * 4194305) * 4294967296;
		const now = new Date();
		const msSinceMidnight = (
			now.getHours() * 3600000 +
			now.getMinutes() * 60000 +
			now.getSeconds() * 1000 +
			now.getMilliseconds()
		);
		return String(t + n + msSinceMidnight);
	}

	// --- Credential Class ---

	class Credential {
		constructor({
			openid = "",
			refresh_token = "",
			access_token = "",
			expired_at = 0,
			musicid = 0,
			musickey = "",
			unionid = "",
			str_musicid = "",
			refresh_key = "",
			encrypt_uin = "",
			login_type = 0,
			extra_fields = {}
		} = {}) {
			this.openid = openid;
			this.refresh_token = refresh_token;
			this.access_token = access_token;
			this.expired_at = expired_at;
			this.musicid = musicid;
			this.musickey = musickey;
			this.unionid = unionid;
			this.str_musicid = str_musicid || String(musicid);
			this.refresh_key = refresh_key;
			this.encrypt_uin = encrypt_uin;
			this.login_type = login_type || (musickey && musickey.startsWith("W_X") ? 1 : 2);
			this.extra_fields = extra_fields;
		}

		hasMusicid() {
			return !!this.musicid;
		}

		hasMusickey() {
			return !!this.musickey;
		}

		asDict() {
			return {
				openid: this.openid,
				refresh_token: this.refresh_token,
				access_token: this.access_token,
				expired_at: this.expired_at,
				musicid: this.musicid,
				musickey: this.musickey,
				unionid: this.unionid,
				str_musicid: this.str_musicid,
				refresh_key: this.refresh_key,
				encryptUin: this.encrypt_uin,
				loginType: this.login_type,
				...this.extra_fields
			};
		}

		asJSON() {
			return JSON.stringify(this.asDict());
		}

		static fromCookiesDict(cookies) {
			// Accepts a plain object (cookie dict)
			return new Credential({
				openid: cookies.openid || "",
				refresh_token: cookies.refresh_token || "",
				access_token: cookies.access_token || "",
				expired_at: cookies.expired_at || 0,
				musicid: Number(cookies.musicid || 0),
				musickey: cookies.musickey || "",
				unionid: cookies.unionid || "",
				str_musicid: cookies.str_musicid || String(cookies.musicid || ""),
				refresh_key: cookies.refresh_key || "",
				encrypt_uin: cookies.encryptUin || "",
				login_type: cookies.loginType || 0,
				extra_fields: cookies
			});
		}

		static fromCookiesStr(cookiesStr) {
			// Accepts a JSON string
			return Credential.fromCookiesDict(JSON.parse(cookiesStr));
		}
	}

	// --- getSession (singleton pattern for axios instance) ---

	let _session = null;
	function getSession() {
		if (!_session) {
			_session = axios.create({
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.54",
					"Referer": "y.qq.com"
				}
			});
		}
		return _session;
	}

	/**
	 * ApiRequest - 進階版，支援自訂處理器、錯誤碼處理、憑證/COOKIE邏輯
	 * @param {string} module
	 * @param {string} method
	 * @param {Object} [common={}]
	 * @param {Object} [params={}]
	 * @param {Credential|null} [credential=null]
	 * @param {boolean} [cacheable=true]
	 * @param {function(Object):any} [processor]
	 * @param {Array<number>} [catchErrorCode=[]]
	 * @returns {Promise<any>}
	 */
	async function ApiRequest(
		module,
		method,
		common = {},
		params = {},
		credential = null,
		cacheable = true,
		processor = null,
		catchErrorCode = []
	) {
		const url = "https://u.y.qq.com/cgi-bin/musicu.fcg";
		const comm = {
			ct: "11",
			tmeAppID: "qqmusic",
			format: "json",
			inCharset: "utf-8",
			outCharset: "utf-8",
			uid: "3931641530",
			...common
		};
		if (
			credential &&
			credential.hasMusicid &&
			credential.hasMusicid() &&
			credential.hasMusickey &&
			credential.hasMusickey()
		) {
			comm.qq = String(credential.musicid);
			comm.authst = credential.musickey;
			comm.tmeLoginType = String(credential.login_type);
		}
		const data = {
			comm,
			[`${module}.${method}`]: {
				module,
				method,
				param: params
			}
		};

		try {
			const resp = await getSession().post(url, data);
			const key = `${module}.${method}`;
			let reqData = resp.data && resp.data[key] ? resp.data[key] : resp.data;
			const code = reqData.code ?? 0;
			if (code !== 0 && !catchErrorCode.includes(code)) {
				if (code === 2000) {
					notifyError("SignInvalidError: 簽名無效");
					throw new Error("SignInvalidError");
				}
				if (code === 1000) {
					notifyError("CredentialExpiredError: 憑證過期");
					throw new Error("CredentialExpiredError");
				}
				notifyError(`API Error: code=${code}`);
				throw new Error(`API Error: code=${code}`);
			}
			if (processor && typeof processor === "function") {
				return processor(reqData.data || reqData);
			}
			return reqData.data || reqData;
		} catch (e) {
			notifyError(`[ApiRequest] ${e.message}`);
			throw e;
		}
	}

	// --- API Functions ---

	async function checkExpired(credential) {
		try {
			await ApiRequest('music.UserInfo.userInfoServer', 'GetLoginUserInfo', {}, credential, false);
			return false;
		} catch (e) {
			notifyError('Credential expired or API error');
			return true;
		}
	}

	async function refreshCookies(credential) {
		const params = {
			refresh_key: credential.refresh_key,
			refresh_token: credential.refresh_token,
			musickey: credential.musickey,
			musicid: credential.musicid
		};
		try {
			const resp = await ApiRequest('music.login.LoginServer', 'Login', { tmeLoginType: String(credential.login_type) }, params, credential, false);
			const c = Credential.fromCookiesDict(resp);
			Object.assign(credential, c);
			return true;
		} catch (e) {
			notifyError('Failed to refresh cookies');
			return false;
		}
	}

	async function getQrcode(loginType) {
		if (loginType === QRLoginType.WX) return await _getWxQr();
		return await _getQqQr();
	}

	async function _getQqQr() {
		const res = await axios.get('https://ssl.ptlogin2.qq.com/ptqrshow', {
			params: {
				appid: '716027609',
				e: '2',
				l: 'M',
				s: '3',
				d: '72',
				v: '4',
				t: Math.random().toString(),
				daid: '383',
				pt_3rd_aid: '100497308'
			},
			headers: { Referer: 'https://xui.ptlogin2.qq.com/' },
			responseType: 'arraybuffer'
		});
		// extract the qrsig cookie (handle both Array or single String)
		const raw = res.headers['set-cookie'] || res.headers['Set-Cookie'];
		const list = Array.isArray(raw)
			? raw
			: (typeof raw === 'string' ? [raw] : []);
		const ck = list.find(s => s.startsWith('qrsig='));
		if (!ck) {
			throw new Error('QQ _getQqQr(): missing qrsig cookie');
		}
		const qrsig = ck.split(';')[0].substring(6);
		return new QR(res.data, QRLoginType.QQ, 'image/png', qrsig);
	}

	async function _getWxQr() {
		const res = await axios.get('https://open.weixin.qq.com/connect/qrconnect', {
			params: {
				appid: 'wx48db31d50e334801',
				redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/',
				response_type: 'code',
				scope: 'snsapi_login',
				state: 'STATE',
				href: 'https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect'
			}
		});
		const uuidMatch = res.data.match(/uuid=(.+?)"/);
		const uuid = uuidMatch ? uuidMatch[1] : null;
		if (!uuid) {
			notifyError('[WXLogin] 获取 uuid 失败');
			return null;
		}
		const qrRes = await axios.get(`https://open.weixin.qq.com/connect/qrcode/${uuid}`, {
			headers: { Referer: 'https://open.weixin.qq.com/connect/qrconnect' },
			responseType: 'arraybuffer'
		});
		return new QR(qrRes.data, QRLoginType.WX, 'image/jpeg', uuid);
	}

	async function checkQrcode(qrcode) {
		if (qrcode.qrType === QRLoginType.WX) return await _checkWxQr(qrcode);
		return await _checkQqQr(qrcode);
	}

	async function _checkQqQr(qrcode) {
		const qrsig = qrcode.identifier;
		let resp;
		try {
			resp = await axios.get('https://ssl.ptlogin2.qq.com/ptqrlogin', {
				params: {
					u1: 'https://graph.qq.com/oauth2.0/login_jump',
					ptqrtoken: hash33(qrsig),
					ptredirect: '0',
					h: '1',
					t: '1',
					g: '1',
					from_ui: '1',
					ptlang: '2052',
					action: `0-0-${Date.now()}`,
					js_ver: '20102616',
					js_type: '1',
					pt_uistyle: '40',
					aid: '716027609',
					daid: '383',
					pt_3rd_aid: '100497308',
					has_onekey: '1'
				},
				headers: {
					Referer: 'https://xui.ptlogin2.qq.com/',
					Cookie: `qrsig=${qrsig}`
				}
			});
		} catch (e) {
			notifyError('[QQLogin] 无效 qrsig');
			return ['OTHER', null];
		}
		const match = resp.data.match(/ptuiCB\((.*?)\)/);
		if (!match) {
			notifyError('[QQLogin] 获取二维码状态失败');
			return ['OTHER', null];
		}
		const data = match[1].split(',').map(s => s.replace(/^'+|'+$/g, ''));
		const codeStr = data[0];
		if (/^\d+$/.test(codeStr)) {
			const event = QRCodeLoginEvents.getByValue(Number(codeStr));
			if (event === 'DONE') {
				const sigx = data[2].match(/&ptsigx=(.+?)&s_url/)[1];
				const uin = data[2].match(/&uin=(.+?)&service/)[1];
				return [event, await _authorizeQqQr(uin, sigx)];
			}
			return [event, null];
		}
		return ['OTHER', null];
	}

	async function _checkWxQr(qrcode) {
		const uuid = qrcode.identifier;
		let resp;
		try {
			resp = await axios.get('https://lp.open.weixin.qq.com/connect/l/qrconnect', {
				params: { uuid, _: Date.now() },
				headers: { Referer: 'https://open.weixin.qq.com/' }
			});
		} catch (e) {
			return ['SCAN', null];
		}
		const match = resp.data.match(/window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/);
		if (!match) {
			notifyError('[WXLogin] 获取二维码状态失败');
			return ['OTHER', null];
		}
		const wxErrcode = match[1];
		const event = QRCodeLoginEvents.getByValue(Number(wxErrcode));
		if (event === 'DONE') {
			const wxCode = match[2];
			if (!wxCode) {
				notifyError('[WXLogin] 获取 code 失败');
				return [event, null];
			}
			return [event, await _authorizeWxQr(wxCode)];
		}
		return [event, null];
	}

	async function _authorizeQqQr(uin, sigx) {
		try {
			// Step 1: Get p_skey from check_sig
			const checkSigResp = await getSession().get(
				'https://ssl.ptlogin2.graph.qq.com/check_sig',
				{
					params: {
						uin: uin,
						pttype: '1',
						service: 'ptqrlogin',
						nodirect: '0',
						ptsigx: sigx,
						s_url: 'https://graph.qq.com/oauth2.0/login_jump',
						ptlang: '2052',
						ptredirect: '100',
						aid: '716027609',
						daid: '383',
						j_later: '0',
						low_login_hour: '0',
						regmaster: '0',
						pt_login_type: '3',
						pt_aid: '0',
						pt_aaid: '16',
						pt_light: '0',
						pt_3rd_aid: '100497308'
					},
					headers: {
						Referer: 'https://xui.ptlogin2.qq.com/'
					},
					maxRedirects: 0,
					validateStatus: status => status >= 200 && status < 400 // allow 302
				}
			);
			// Extract p_skey from cookies
			const setCookie = checkSigResp.headers['set-cookie'] || [];
			const p_skey = setCookie.map(c => c.match(/p_skey=([^;]+)/)).find(m => m)?.[1];
			if (!p_skey) {
				notifyError('[QQLogin] 获取 p_skey 失败');
				return null;
			}

			// Step 2: POST to QQ OAuth2 to get code (handle redirect)
			const postResp = await getSession().post(
				'https://graph.qq.com/oauth2.0/authorize',
				new URLSearchParams({
					response_type: 'code',
					client_id: '100497308',
					redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F',
					scope: 'get_user_info,get_app_friends',
					state: 'state',
					switch: '',
					from_ptlogin: '1',
					src: '1',
					update_auth: '1',
					openapi: '1010_1030',
					g_tk: hash33(p_skey, 5381),
					auth_time: String(Date.now()),
					ui: uuidv4()
				}),
				{
					maxRedirects: 0,
					validateStatus: status => status >= 200 && status < 400,
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded'
					}
				}
			);
			// The code is in the Location header of the redirect
			const location = postResp.headers['location'] || postResp.headers['Location'] || '';
			const codeMatch = location.match(/code=([^&]+)/);
			if (!codeMatch) {
				notifyError('[QQLogin] 获取 code 失败');
				return null;
			}
			const code = codeMatch[1];

			// Step 3: Use code to get Credential
			const resp = await ApiRequest(
				'music.login.LoginServer',
				'Login',
				{ tmeLoginType: '2' },
				{ code: code },
				null,
				false
			);
			return Credential.fromCookiesDict(resp);
		} catch (e) {
			notifyError('[QQLogin] 无法重复鉴权或网络错误');
			return null;
		}
	}

	async function _authorizeWxQr(code) {
		try {
			const resp = await ApiRequest(
				'music.login.LoginServer',
				'Login',
				{ tmeLoginType: '1' },
				{ code: code, strAppid: 'wx48db31d50e334801' },
				null,
				false
			);
			return Credential.fromCookiesDict(resp);
		} catch (e) {
			notifyError('[WXLogin] 无法重复鉴权或网络错误');
			return null;
		}
	}

	async function sendAuthcode(phone, countryCode = 86) {
		const resp = await ApiRequest('music.login.LoginServer', 'SendPhoneAuthCode', { tmeLoginMethod: '3' }, {
			tmeAppid: 'qqmusic',
			phoneNo: String(phone),
			areaCode: String(countryCode)
		}, null, false, true);
		switch (resp.code) {
			case 20276:
				return [PhoneLoginEvents.CAPTCHA, resp.data.securityURL];
			case 100001:
				return [PhoneLoginEvents.FREQUENCY, null];
			case 0:
				return [PhoneLoginEvents.SEND, null];
			default:
				notifyError('[PhoneLogin] ' + (resp.data?.errMsg || '未知错误'));
				return [PhoneLoginEvents.OTHER, resp.data?.errMsg];
		}
	}

	async function phoneAuthorize(phone, authCode, countryCode = 86) {
		const resp = await ApiRequest('music.login.LoginServer', 'Login', { tmeLoginMethod: '3', tmeLoginType: '0' }, {
			code: String(authCode),
			phoneNo: String(phone),
			areaCode: String(countryCode),
			loginMode: 1
		}, null, false, true);
		switch (resp.code) {
			case 20271:
				notifyError('[PhoneLogin] 验证码错误或已鉴权');
				throw new Error('[PhoneLogin] 验證碼錯誤或已鑑權');
			case 0:
				return Credential.fromCookiesDict(resp.data);
			default:
				notifyError('[PhoneLogin] 未知原因导致鉴权失败');
				throw new Error('[PhoneLogin] 未知原因導致鑑權失敗');
		}
	}

	// --- Song-related API Functions ---

	/**
	 * Helper to extract a key from API response.
	 * @param {string} key
	 * @returns {function(Object): Array}
	 */
	function _getExtractFunc(key) {
		return function (data) {
			return data[key] || [];
		};
	}

	/**
	 * Query song info by id or mid.
	 * @param {Array<number|string>} value
	 * @returns {Promise<Array<Object>>}
	 */
	async function querySong(value) {
		const params = {
			types: Array(value.length).fill(0),
			modify_stamp: Array(value.length).fill(0),
			ctx: 0,
			client: 1
		};
		if (typeof value[0] === 'number') {
			params.ids = value;
		} else {
			params.mids = value;
		}
		const res = await ApiRequest(
			"music.trackInfo.UniformRuleCtrl",
			"CgiGetTrackInfo",
			{},
			params
		);
		return res.tracks || [];
	}

	/**
	 * Song file types (partial, add more as needed).
	 */
	const SongFileType = {
		MASTER: { s: "AI00", e: ".flac" },
		ATMOS_2: { s: "Q000", e: ".flac" },
		ATMOS_51: { s: "Q001", e: ".flac" },
		FLAC: { s: "F000", e: ".flac" },
		OGG_640: { s: "O801", e: ".ogg" },
		OGG_320: { s: "O800", e: ".ogg" },
		OGG_192: { s: "O600", e: ".ogg" },
		OGG_96: { s: "O400", e: ".ogg" },
		MP3_320: { s: "M800", e: ".mp3" },
		MP3_128: { s: "M500", e: ".mp3" },
		ACC_192: { s: "C600", e: ".m4a" },
		ACC_96: { s: "C400", e: ".m4a" },
		ACC_48: { s: "C200", e: ".m4a" }
	};

	const EncryptedSongFileType = {
		MASTER: { s: "AIM0", e: ".mflac" },
		ATMOS_2: { s: "Q0M0", e: ".mflac" },
		ATMOS_51: { s: "Q0M1", e: ".mflac" },
		FLAC: { s: "F0M0", e: ".mflac" },
		OGG_640: { s: "O801", e: ".mgg" },
		OGG_320: { s: "O800", e: ".mgg" },
		OGG_192: { s: "O6M0", e: ".mgg" },
		OGG_96: { s: "O4M0", e: ".mgg" }
	};

	/**
	 * Get song URLs (supports both normal and encrypted types).
	 * @param {Array<string>} mid
	 * @param {Object} fileType
	 * @param {Credential|null} credential
	 * @returns {Promise<Object>}
	 */
	async function getSongUrls(mid, fileType = SongFileType.MP3_128, credential = null) {
		const encrypted = Object.values(EncryptedSongFileType).includes(fileType);
		// Split mid list into chunks of 100
		const midList = [];
		for (let i = 0; i < mid.length; i += 100) {
			midList.push(mid.slice(i, i + 100));
		}
		const domain = "https://isure.stream.qqmusic.qq.com/";
		const apiData = !encrypted
			? ["music.vkey.GetVkey", "UrlGetVkey"]
			: ["music.vkey.GetEVkey", "CgiGetEVkey"];

		function processor(res) {
			const urls = {};
			const data = res.midurlinfo;
			for (const info of data) {
				const songUrl = info.wifiurl ? domain + info.wifiurl : "";
				if (!encrypted) {
					urls[info.songmid] = songUrl;
				} else {
					urls[info.songmid] = [songUrl, info.ekey];
				}
			}
			return urls;
		}

		let result = {};
		for (const mids of midList) {
			const fileNames = mids.map(m => `${fileType.s}${m}${m}${fileType.e}`);
			const params = {
				filename: fileNames,
				guid: getGuid(),
				songmid: mids,
				songtype: Array(mids.length).fill(0)
			};
			const res = await ApiRequest(
				apiData[0],
				apiData[1],
				{},
				params,
				credential
			);
			Object.assign(result, processor(res));
		}
		return result;
	}

	/**
	 * Get try (preview) url for a song.
	 * @param {string} mid
	 * @param {string} vs
	 * @returns {Promise<string>}
	 */
	async function getTryUrl(mid, vs) {
		const params = {
			filename: [`RS02${vs}.mp3`],
			guid: getGuid(),
			songmid: [mid],
			songtype: [1]
		};
		const res = await ApiRequest(
			"music.vkey.GetVkey",
			"UrlGetVkey",
			{},
			params
		);
		const url = res.midurlinfo?.[0]?.wifiurl;
		return url ? `https://isure.stream.qqmusic.qq.com/${url}` : "";
	}

	/**
	 * Get song detail by id or mid.
	 * @param {string|number} value
	 * @returns {Promise<Object>}
	 */
	async function getDetail(value) {
		let params;
		if (typeof value === "number") {
			params = { song_id: value };
		} else {
			params = { song_mid: value };
		}
		return await ApiRequest(
			"music.pf_song_detail_svr",
			"get_song_detail_yqq",
			{},
			params
		);
	}

	/**
	 * Get similar songs.
	 * @param {number} songid
	 * @returns {Promise<Array<Object>>}
	 */
	async function getSimilarSong(songid) {
		const params = { songid };
		const res = await ApiRequest(
			"music.recommend.TrackRelationServer",
			"GetSimilarSongs",
			{},
			params
		);
		return res.vecSong || [];
	}

	/**
	 * Get song labels.
	 * @param {number} songid
	 * @returns {Promise<Array<Object>>}
	 */
	async function getLabels(songid) {
		const params = { songid };
		const res = await ApiRequest(
			"music.recommend.TrackRelationServer",
			"GetSongLabels",
			{},
			params
		);
		return res.labels || [];
	}

	/**
	 * Get related playlists for a song.
	 * @param {number} songid
	 * @returns {Promise<Array<Object>>}
	 */
	async function getRelatedSonglist(songid) {
		const params = { songid };
		const res = await ApiRequest(
			"music.recommend.TrackRelationServer",
			"GetRelatedPlaylist",
			{},
			params
		);
		return res.vecPlaylist || [];
	}

	/**
	 * Get related MVs for a song.
	 * @param {number} songid
	 * @param {string|null} lastMvid
	 * @returns {Promise<Array<Object>>}
	 */
	async function getRelatedMv(songid, lastMvid = null) {
		const params = {
			songid,
			songtype: 1,
			...(lastMvid ? { lastmvid: lastMvid } : {})
		};
		const res = await ApiRequest(
			"MvService.MvInfoProServer",
			"GetSongRelatedMv",
			{},
			params
		);
		return res.list || [];
	}

	/**
	 * Get other versions of a song.
	 * @param {string|number} value
	 * @returns {Promise<Array<Object>>}
	 */
	async function getOtherVersion(value) {
		let params;
		if (typeof value === "number") {
			params = { songid: value };
		} else {
			params = { songmid: value };
		}
		const res = await ApiRequest(
			"music.musichallSong.OtherVersionServer",
			"GetOtherVersionSongs",
			{},
			params
		);
		return res.versionList || [];
	}

	/**
	 * Get song producer info.
	 * @param {string|number} value
	 * @returns {Promise<Array<Object>>}
	 */
	async function getProducer(value) {
		let params;
		if (typeof value === "number") {
			params = { songid: value };
		} else {
			params = { songmid: value };
		}
		const res = await ApiRequest(
			"music.sociality.KolWorksTag",
			"SongProducer",
			{},
			params
		);
		return res.Lst || [];
	}

	/**
	 * Get sheet music for a song.
	 * @param {string} mid
	 * @returns {Promise<Array<Object>>}
	 */
	async function getSheet(mid) {
		const params = { songmid: mid, scoreType: -1 };
		const res = await ApiRequest(
			"music.mir.SheetMusicSvr",
			"GetMoreSheetMusic",
			{},
			params
		);
		return res.result || [];
	}

	/**
	 * Get favorite numbers for a list of song ids.
	 * @param {Array<number>} songid
	 * @returns {Promise<Object>}
	 */
	async function getFavNum(songid) {
		const params = { v_songId: songid };
		const res = await ApiRequest(
			"music.musicasset.SongFavRead",
			"GetSongFansNumberById",
			{},
			params
		);
		return res.m_show || {};
	}

	// --- Singer-related ENUMS ---

	const AreaType = {
		ALL: -100,
		CHINA: 200,
		TAIWAN: 2,
		AMERICA: 5,
		JAPAN: 4,
		KOREA: 3
	};

	const GenreType = {
		ALL: -100,
		POP: 7,
		RAP: 3,
		CHINESE_STYLE: 19,
		ROCK: 4,
		ELECTRONIC: 2,
		FOLK: 8,
		R_AND_B: 11,
		ETHNIC: 37,
		LIGHT_MUSIC: 93,
		JAZZ: 14,
		CLASSICAL: 33,
		COUNTRY: 13,
		BLUES: 10
	};

	const SexType = {
		ALL: -100,
		MALE: 0,
		FEMALE: 1,
		GROUP: 2
	};

	const TabType = {
		WIKI: { tab_id: "wiki", tab_name: "IntroductionTab" },
		ALBUM: { tab_id: "album", tab_name: "AlbumTab" },
		COMPOSER: { tab_id: "song_composing", tab_name: "SongTab" },
		LYRICIST: { tab_id: "song_lyric", tab_name: "SongTab" },
		PRODUCER: { tab_id: "producer", tab_name: "SongTab" },
		ARRANGER: { tab_id: "arranger", tab_name: "SongTab" },
		MUSICIAN: { tab_id: "musician", tab_name: "SongTab" },
		SONG: { tab_id: "song_sing", tab_name: "SongTab" },
		VIDEO: { tab_id: "video", tab_name: "VideoTab" }
	};

	const IndexType = {
		A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10, K: 11, L: 12, M: 13, N: 14, O: 15,
		P: 16, Q: 17, R: 18, S: 19, T: 20, U: 21, V: 22, W: 23, X: 24, Y: 25, Z: 26, ALL: -100, HASH: 27
	};

	function validateIntEnum(value, enumType) {
		const values = Object.values(enumType);
		if (values.includes(value)) return value;
		notifyError(`Invalid value: ${value} for enum`);
		throw new Error(`Invalid value: ${value} for enum`);
	}

	// --- Singer-related API Functions ---

	/**
	 * 获取歌手列表
	 */
	async function getSingerList(area = AreaType.ALL, sex = SexType.ALL, genre = GenreType.ALL) {
		area = validateIntEnum(area, AreaType);
		sex = validateIntEnum(sex, SexType);
		genre = validateIntEnum(genre, GenreType);

		const params = {
			hastag: 0,
			area,
			sex,
			genre
		};
		const res = await ApiRequest(
			"music.musichallSinger.SingerList",
			"GetSingerList",
			{},
			params
		);
		return res.hotlist || [];
	}

	/**
	 * 获取歌手列表原始数据
	 */
	async function getSingerListIndex(area = AreaType.ALL, sex = SexType.ALL, genre = GenreType.ALL, index = IndexType.ALL, sin = 0, cur_page = 1) {
		area = validateIntEnum(area, AreaType);
		sex = validateIntEnum(sex, SexType);
		genre = validateIntEnum(genre, GenreType);
		index = validateIntEnum(index, IndexType);

		const params = {
			area,
			sex,
			genre,
			index,
			sin,
			cur_page
		};
		return await ApiRequest(
			"music.musichallSinger.SingerList",
			"GetSingerListIndex",
			{},
			params
		);
	}

	/**
	 * 获取所有歌手列表
	 */
	async function getSingerListIndexAll(area = AreaType.ALL, sex = SexType.ALL, genre = GenreType.ALL, index = IndexType.ALL) {
		area = validateIntEnum(area, AreaType);
		sex = validateIntEnum(sex, SexType);
		genre = validateIntEnum(genre, GenreType);
		index = validateIntEnum(index, IndexType);

		const firstPage = await getSingerListIndex(area, sex, genre, index, 0, 1);
		let singerList = firstPage.singerlist || [];
		const total = firstPage.total || 0;
		if (total <= 80) return singerList;

		const requests = [];
		for (let sin = 80, page = 2; sin < total; sin += 80, page++) {
			requests.push(getSingerListIndex(area, sex, genre, index, sin, page));
		}
		const results = await Promise.all(requests);
		for (const res of results) {
			if (res.singerlist) singerList = singerList.concat(res.singerlist);
		}
		return singerList;
	}

	/**
	 * 获取歌手基本信息
	 */
	async function getSingerInfo(mid) {
		const params = { SingerMid: mid };
		return await ApiRequest(
			"music.UnifiedHomepage.UnifiedHomepageSrv",
			"GetHomepageHeader",
			{},
			params
		);
	}

	/**
	 * 获取歌手 Tab 详细信息
	 */
	async function getSingerTabDetail(mid, tabType, page = 1, num = 10) {
		const tab = TabType[tabType] || tabType;
		const params = {
			SingerMid: mid,
			IsQueryTabDetail: 1,
			TabID: tab.tab_id,
			PageNum: page - 1,
			PageSize: num,
			Order: 0
		};
		const res = await ApiRequest(
			"music.UnifiedHomepage.UnifiedHomepageSrv",
			"GetHomepageTabDetail",
			{},
			params
		);
		const data = res[tab.tab_name];
		return data?.List || data?.VideoList || data?.AlbumList || data || [];
	}

	/**
	 * 获取歌手简介
	 */
	async function getSingerDesc(mids) {
		const params = { singer_mids: mids, groups: 1, wikis: 1 };
		const res = await ApiRequest(
			"music.musichallSinger.SingerInfoInter",
			"GetSingerDetail",
			{},
			params
		);
		return res.singer_list || [];
	}

	/**
	 * 获取类似歌手列表
	 */
	async function getSimilarSinger(mid, number = 10) {
		const params = { singerMid: mid, number };
		const res = await ApiRequest(
			"music.SimilarSingerSvr",
			"GetSimilarSingerList",
			{},
			params
		);
		return res.singerlist || [];
	}

	/**
	 * 获取歌手歌曲（Tab）
	 */
	async function getSingerSongs(mid, tabType = TabType.SONG, page = 1, num = 10) {
		return await getSingerTabDetail(mid, tabType, page, num);
	}

	/**
	 * 获取歌手歌曲原始数据
	 */
	async function getSingerSongsList(mid, number = 10, begin = 0) {
		const params = {
			singerMid: mid,
			order: 1,
			number,
			begin
		};
		return await ApiRequest(
			"musichall.song_list_server",
			"GetSingerSongList",
			{},
			params
		);
	}

	/**
	 * 获取歌手所有歌曲列表
	 */
	async function getSingerSongsListAll(mid) {
		const first = await getSingerSongsList(mid, 30, 0);
		const total = first.totalNum || 0;
		let songs = (first.songList || []).map(song => song.songInfo);
		if (total <= 30) return songs;

		const requests = [];
		for (let begin = 30; begin < total; begin += 30) {
			requests.push(getSingerSongsList(mid, 30, begin));
		}
		const results = await Promise.all(requests);
		for (const res of results) {
			songs = songs.concat((res.songList || []).map(song => song.songInfo));
		}
		return songs;
	}

	/**
	 * 获取歌手专辑
	 */
	async function getSingerAlbumList(mid, number = 10, begin = 0) {
		const params = {
			singerMid: mid,
			order: 1,
			number,
			begin
		};
		return await ApiRequest(
			"music.musichallAlbum.AlbumListServer",
			"GetAlbumList",
			{},
			params
		);
	}

	/**
	 * 获取歌手所有专辑列表
	 */
	async function getSingerAlbumListAll(mid) {
		const first = await getSingerAlbumList(mid, 30, 0);
		const total = first.total || 0;
		let albums = first.albumList || [];
		if (total <= 30) return albums;

		const requests = [];
		for (let begin = 30; begin < total; begin += 30) {
			requests.push(getSingerAlbumList(mid, 30, begin));
		}
		const results = await Promise.all(requests);
		for (const res of results) {
			albums = albums.concat(res.albumList || []);
		}
		return albums;
	}

	/**
	 * 获取歌手MV原始数据
	 */
	async function getSingerMvList(mid, number = 10, begin = 0) {
		const params = {
			singermid: mid,
			order: 1,
			count: number,
			start: begin
		};
		return await ApiRequest(
			"MvService.MvInfoProServer",
			"GetSingerMvList",
			{},
			params
		);
	}

	/**
	 * 获取歌手所有MV列表
	 */
	async function getSingerMvListAll(mid) {
		const first = await getSingerMvList(mid, 100, 0);
		const total = first.total || 0;
		let mvs = first.list || [];
		if (total <= 100) return mvs;

		const requests = [];
		for (let begin = 100; begin < total; begin += 100) {
			requests.push(getSingerMvList(mid, 100, begin));
		}
		const results = await Promise.all(requests);
		for (const res of results) {
			mvs = mvs.concat(res.list || []);
		}
		return mvs;
	}

	// --- Search-related ENUMS ---

	const SearchType = {
		SONG: 0,
		SINGER: 1,
		ALBUM: 2,
		SONGLIST: 3,
		MV: 4,
		LYRIC: 7,
		USER: 8,
		AUDIO_ALBUM: 15,
		AUDIO: 18
	};

	/**
	 * 获取热搜词
	 * @returns {Promise<Object>}
	 */
	async function hotkey() {
		const params = { search_id: getSearchID() };
		return await ApiRequest(
			"music.musicsearch.HotkeyService",
			"GetHotkeyForQQMusicMobile",
			{},
			params
		);
	}

	/**
	 * 搜索词补全
	 * @param {string} keyword
	 * @returns {Promise<Object>}
	 */
	async function complete(keyword) {
		const params = {
			search_id: getSearchID(),
			query: keyword,
			num_per_page: 0,
			page_idx: 0
		};
		return await ApiRequest(
			"music.smartboxCgi.SmartBoxCgi",
			"GetSmartBoxResult",
			{},
			params
		);
	}

	/**
	 * 快速搜索
	 * @param {string} keyword
	 * @returns {Promise<Object>}
	 */
	async function quickSearch(keyword) {
		const resp = await getSession().get(
			"https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg",
			{ params: { key: keyword } }
		);
		return resp.data?.data || {};
	}

	/**
	 * 综合搜索
	 * @param {string} keyword
	 * @param {number} page
	 * @param {boolean} highlight
	 * @returns {Promise<Object>}
	 */
	async function generalSearch(keyword, page = 1, highlight = true) {
		const params = {
			searchid: getSearchID(),
			search_type: 100,
			page_num: 15,
			query: keyword,
			page_id: page,
			highlight: highlight,
			grp: 1
		};
		return await ApiRequest(
			"music.adaptor.SearchAdaptor",
			"do_search_v2",
			{},
			params
		);
	}

	/**
	 * 按类型搜索
	 * @param {string} keyword
	 * @param {number} searchType
	 * @param {number} num
	 * @param {number} page
	 * @param {boolean} highlight
	 * @returns {Promise<Array<Object>>}
	 */
	async function searchByType(keyword, searchType = SearchType.SONG, num = 10, page = 1, highlight = true) {
		const params = {
			searchid: getSearchID(),
			query: keyword,
			search_type: searchType,
			num_per_page: num,
			page_num: page,
			highlight: highlight,
			grp: 1
		};
		// treat code 104400 (“MID not found” / no results) as harmless → return []
		const res = await ApiRequest(
			"music.search.SearchCgiService",
			"DoSearchForQQMusicMobile",
			{},
			params,
			/* credential */  null,
			/* cacheable */   true,
			/* processor */   null,
			/* catchErrorCode */[104400]
		);
		// Extract the correct result type
		const types = {
			[SearchType.SONG]: "item_song",
			[SearchType.SINGER]: "singer",
			[SearchType.ALBUM]: "item_album",
			[SearchType.SONGLIST]: "item_songlist",
			[SearchType.MV]: "item_mv",
			[SearchType.LYRIC]: "item_song",
			[SearchType.USER]: "item_user",
			[SearchType.AUDIO_ALBUM]: "item_audio",
			[SearchType.AUDIO]: "item_song"
		};
		try {
			return res.body?.[types[searchType]] || [];
		} catch {
			return [];
		}
	}

	/**
	 * qrcDecrypt: 解密 QRC 数据
	 *
	 * @param {string | ArrayBuffer | Uint8Array} encryptedQrc - 加密的 QRC 数据，支持十六进制字符串、ArrayBuffer 或 Uint8Array
	 * @returns {string} 解密并解压缩后的 QRC 字符串
	 * @throws {Error} 解密或解压失败时抛出
	 */
	function qrcDecrypt(encryptedQrc) {
		if (!encryptedQrc) {
			return "";
		}

		// 将输入转为 Uint8Array
		let encBytes;
		if (typeof encryptedQrc === 'string') {
			// 假设是十六进制表示
			const hex = encryptedQrc.replace(/\s+/g, '');
			if (hex.length % 2 !== 0) {
				throw new Error('无效的十六进制字符串长度');
			}
			encBytes = new Uint8Array(hex.length / 2);
			for (let i = 0; i < hex.length; i += 2) {
				encBytes[i / 2] = parseInt(hex.substr(i, 2), 16);
			}
		} else if (encryptedQrc instanceof ArrayBuffer) {
			encBytes = new Uint8Array(encryptedQrc);
		} else if (encryptedQrc instanceof Uint8Array) {
			encBytes = encryptedQrc;
		} else {
			throw new Error("无效的加密数据类型");
		}

		try {
			// 构造 3 个子密钥表，每个子密钥表含 16 行，每行 6 字节
			const schedule = [
				Array.from({ length: 16 }, () => new Uint8Array(6)),
				Array.from({ length: 16 }, () => new Uint8Array(6)),
				Array.from({ length: 16 }, () => new Uint8Array(6))
			];

			// 固定的 TripleDES 密钥（与 Python 中 b"!@#)(*$%123ZXC!@!@#)(NHL" 对应）
			const keyString = "!@#)(*$%123ZXC!@!@#)(NHL";
			const keyBytes = new Uint8Array(keyString.length);
			for (let i = 0; i < keyString.length; i++) {
				keyBytes[i] = keyString.charCodeAt(i);
			}

			// 初始化子密钥表，模式为解密
			DESHelper.TripleDESKeySetup(keyBytes, schedule, DESHelper.DECRYPT);

			// 分块解密：每 8 字节一块
			const decryptedParts = [];
			for (let offset = 0; offset < encBytes.length; offset += 8) {
				const block = encBytes.subarray(offset, offset + 8);
				const chunk = new Uint8Array(8);
				chunk.set(block);
				const outBuf = new Uint8Array(8);
				DESHelper.TripleDESCrypt(chunk, outBuf, schedule);
				for (let b = 0; b < 8; b++) {
					decryptedParts.push(outBuf[b]);
				}
			}

			const decryptedBytes = new Uint8Array(decryptedParts);

			// 使用 pako 解压缩（zlib）
			const decompressed = pako.inflate(decryptedBytes);

			// 将 Uint8Array 转为 UTF-8 字符串
			const decoder = new TextDecoder("utf-8");
			return decoder.decode(decompressed);

		} catch (e) {
			throw new Error(`解密失败: ${e.message || e}`);
		}
	}

	/**
	 * 取得歌詞
	 * @param {string|number} value 歌曲 id 或 mid
	 * @param {boolean} qrc 是否返回逐字歌詞
	 * @param {boolean} trans 是否返回翻譯歌詞
	 * @param {boolean} roma 是否返回羅馬拼音歌詞
	 * @returns {Promise<{lyric: string, trans: string, roma: string}>}
	 */
	async function getLyric(value, qrc = false, trans = false, roma = false) {
		const params = {
			crypt: 1,
			ct: 11,
			cv: 13020508,
			lrc_t: 0,
			qrc: qrc ? 1 : 0,
			qrc_t: 0,
			roma: roma ? 1 : 0,
			roma_t: 0,
			trans: trans ? 1 : 0,
			trans_t: 0,
			type: 1
		};

		if (typeof value === "number") {
			params.songId = value;
		} else {
			params.songMid = value;
		}

		const res = await ApiRequest(
			"music.musichallSong.PlayLyricInfo",
			"GetPlayLyricInfo",
			{},
			params
		);

		console.log(res);

		// 解密並提取內容
		let lyric = qrcDecrypt(res.lyric || "");
		let transLyric = qrcDecrypt(res.trans || "");
		let romaLyric = qrcDecrypt(res.roma || "");

		// QRC/ROMA 提取（匹配 <Lyric_... LyricType="..." LyricContent="..."/>）
		const QRC_PATTERN = /<Lyric_.*?LyricType=".*?" LyricContent="(?<content>.*?)"\/>/s;

		if (lyric && qrc) {
			const m_qrc = QRC_PATTERN.exec(lyric);
			if (m_qrc && m_qrc.groups && m_qrc.groups.content) {
				lyric = m_qrc.groups.content;
			}
		}

		if (romaLyric) {
			const m_roma = QRC_PATTERN.exec(romaLyric);
			if (m_roma && m_roma.groups && m_roma.groups.content) {
				romaLyric = m_roma.groups.content;
			}
		}

		return {
			lyric,
			trans: transLyric,
			roma: romaLyric
		};
	}

	/**
	 * 取得專輯封面連結
	 * @param {string} mid 專輯 mid
	 * @param {number} size 封面大小 (150, 300, 500, 800)
	 * @returns {string}
	 */
	function getAlbumCover(mid, size = 300) {
		const allowed = [150, 300, 500, 800];
		if (!allowed.includes(size)) {
			notifyError("不支援的尺寸");
			throw new Error("不支援的尺寸");
		}
		return `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${mid}.jpg`;
	}

	/**
	 * 取得專輯詳細資訊
	 * @param {string|number} value 專輯 id 或 mid
	 * @returns {Promise<Object>}
	 */
	async function getAlbumDetail(value) {
		let params;
		if (typeof value === "number") {
			params = { albumId: value };
		} else {
			params = { albumMId: value };
		}
		return await ApiRequest(
			"music.musichallAlbum.AlbumInfoServer",
			"GetAlbumDetail",
			{},
			params
		);
	}

	/**
	 * 取得專輯歌曲
	 * @param {string|number} value 專輯 id 或 mid
	 * @param {number} num 返回數量
	 * @param {number} page 頁碼
	 * @returns {Promise<Array<Object>>}
	 */
	async function getAlbumSong(value, num = 10, page = 1) {
		const params = {
			begin: num * (page - 1),
			num: num
		};
		if (typeof value === "number") {
			params.albumId = value;
		} else {
			params.albumMid = value;
		}
		const res = await ApiRequest(
			"music.musichallAlbum.AlbumSongList",
			"GetAlbumSongList",
			{},
			params
		);
		// 回傳 songInfo 陣列
		return (res.songList || []).map(song => song.songInfo);
	}

	// searchByKey → do a song‐only search (uses your existing searchByType)
	async function getSearchByKey(keyword, limit = 10, credential = null) {
		// searchType = 0 means “song”
		return await searchByType(keyword, SearchType.SONG, limit, 1, true);
	}

	// singer albums → pull *all* pages of albums
	async function getSingerAlbum(singerMid, limit = 10, credential = null) {
		try {
			return await getSingerAlbumListAll(singerMid);
		} catch (err) {
			// code 104400 means “MID not found” → return empty list
			if (err.message.includes('104400')) {
				return [];
			}
			throw err;
		}
	}

	// album info → alias to your getAlbumDetail()
	async function getAlbumInfo(albumMid, credential = null) {
		return await getAlbumDetail(albumMid);
	}

	// lyric by songMid → you already have getLyric(value)
	async function getLyricByMid(songMid, credential = null) {
		try {
			return await getLyric(songMid);
		} catch (err) {
			if (err.message.includes('24001')) {
				return {};
			}
			throw err;
		}
	}

	module.exports = {
		// login / QR
		getQrcode,
		checkQrcode,
		QRLoginType,
		QRCodeLoginEvents,
		PhoneLoginEvents,

		// Functions
		getSearchByKey,
		getSingerAlbum,
		getAlbumInfo,
		getAlbumSong,
		getLyricByMid,

		// core
		ApiRequest,
		Credential,
	};
})();