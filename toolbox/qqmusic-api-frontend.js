function openTab(evt, tabName) {
	var i, tabcontent, tabbuttons;
	tabcontent = document.getElementsByClassName("tab-content");
	for (i = 0; i < tabcontent.length; i++) {
		tabcontent[i].style.display = "none";
	}
	tabbuttons = document.getElementsByClassName("tab-button");
	for (i = 0; i < tabbuttons.length; i++) {
		tabbuttons[i].className = tabbuttons[i].className.replace(" active", "");
	}
	document.getElementById(tabName).style.display = "flex";
	evt.currentTarget.className += " active";
}

document.addEventListener('DOMContentLoaded', () => {
	document.getElementById('btn-search-keyword')
		.addEventListener('click', searchByKeyword);
	document.getElementById('btn-get-albums')
		.addEventListener('click', getAlbumsBySinger);
	document.getElementById('btn-get-album')
		.addEventListener('click', getAlbum);
	document.getElementById('btn-get-song')
		.addEventListener('click', getSong);
	document.getElementById('btn-get-all-songs')
		.addEventListener('click', getAllSongs);

	document.querySelectorAll('.tab-button').forEach(btn => {
		btn.addEventListener('click', evt => {
			openTab(evt, btn.dataset.tab);
		});
	});

	// Set default tab
	document.querySelector('.tab-button').click();
});

// global holder for our login credential
window.qqmusicApiCredential = null;

/**
 * loadJSONP
 *  - injects a <script> that calls window[cbName](data)
 */
function loadJSONP(url, cbName) {
	return new Promise(resolve => {
		window[cbName] = data => {
			resolve(data);
			delete window[cbName];
		};
		const s = document.createElement('script');
		s.src = url + `&callback=${cbName}`;
		document.body.appendChild(s);
	});
}

const API_BASE = 'https://qqmusic-api-worker.gaoqz-cs.workers.dev';

async function showLoginDialog() {
	const overlay = document.createElement('div');
	Object.assign(overlay.style, {
		position: 'fixed', top: 0, left: 0,
		width: '100%', height: '100%',
		background: 'rgba(0,0,0,0.5)',
		display: 'flex', alignItems: 'center', justifyContent: 'center',
		zIndex: 9999
	});
	const box = document.createElement('div');
	Object.assign(box.style, {
		background: '#fff', padding: '20px',
		borderRadius: '8px', display: 'flex', gap: '40px'
	});
	overlay.appendChild(box);
	document.body.appendChild(overlay);

	const makeContainer = label => {
		const c = document.createElement('div');
		const title = document.createElement('div');
		title.innerText = label;
		title.style.textAlign = 'center';
		const img = document.createElement('img');
		img.width = img.height = 200;
		img.style.display = 'block';
		img.style.marginTop = '8px';
		c.append(title, img);
		return { container: c, img };
	}
	const { container: qqC, img: qqImg } = makeContainer('QQ Login');
	const { container: wxC, img: wxImg } = makeContainer('WeChat Login');
	box.append(qqC, wxC);

	// fetch the QR images from the worker
	const [qqRes, wxRes] = await Promise.all([
		fetch(`${API_BASE}/api/getQrcode?type=qq`).then(r => r.json()),
		fetch(`${API_BASE}/api/getQrcode?type=wx`).then(r => r.json())
	]);
	qqImg.src = 'data:image/png;base64,' + qqRes.image;
	qqImg.dataset.id = qqRes.identifier;
	wxImg.src = 'data:image/png;base64,' + wxRes.image;
	wxImg.dataset.id = wxRes.identifier;

	// poll every 3s
	return new Promise((resolve, reject) => {
		const timer = setInterval(async () => {
			try {
				for (const [type, img] of [['qq', qqImg], ['wx', wxImg]]) {
					const chk = await fetch(
						`${API_BASE}/api/checkQrcode?type=${type}&id=${img.dataset.id}`
					).then(r => r.json());
					if (chk.event === 'DONE') {
						clearInterval(timer);
						overlay.remove();            // safe removal
						window.qqmusicApiCredential = chk.credential;
						localStorage.setItem(
							'qqmusic_credential',
							JSON.stringify(chk.credential)
						);
						return resolve();
					}
				}
			} catch (e) {
				clearInterval(timer);
				overlay.remove();              // safe removal
				return reject(e);
			}
		}, 3000);
	});
}

async function apiQuery(api, params) {
	// ensure we have credentials
	// if (!window.qqmusicApiCredential) {
	// 	const stored = localStorage.getItem('qqmusic_credential');
	// 	if (stored) window.qqmusicApiCredential = JSON.parse(stored);
	// }
	// if (!window.qqmusicApiCredential) {
	// 	await showLoginDialog();
	// }

	// call the Worker
	const res = await fetch(`${API_BASE}/api/${api}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			// credential: window.qqmusicApiCredential,
			params
		})
	});
	if (!res.ok) {
		throw new Error(`API ${api} failed: ${res.statusText}`);
	}
	return res.json();
}

async function searchByKeyword() {
	const keyword = document.getElementById('input').value;
	try {
		const data = await apiQuery('getSearchByKey', { key: keyword, limit: 20 });
		document.getElementById('output').value = JSON.stringify(data, null, 2);

		let formatted = `Search results for "${keyword}":\n`;
		// data.response is the array of song objects
		const list = data.response || [];
		for (const [i, song] of list.entries()) {
			// name & mid replaced the old songname/songmid
			formatted += `${i + 1}. ${song.name} (${song.mid})`;
			// album nested under song.album
			if (song.album) {
				formatted += `, ${song.album.name} (${song.album.mid})`;
			}
			if (song.singer) {
				// output singer names with MID, join with spaces around slash
				formatted += `, ${song.singer
					.map(s => `${s.name} (${s.mid})`)
					.join(' / ')}`;
			}
			formatted += '\n';
		}
		document.getElementById('output-formatted').value = formatted;
	} catch (e) {
		console.error(e);
	}
}

async function getAlbumsBySinger() {
	const singerMid = document.getElementById('input').value || '001uz8tl04tdL8';
	try {
		const data = await apiQuery('getSingerAlbum', { singerMid: singerMid, limit: 20 });
		document.getElementById('output').value = JSON.stringify(data, null, 2);

		// data.response is now the array of album objects
		// make a copy so we can sort it
		const list = (data.response || []).slice();

		// sort albums by publish date descending (newest first)
		list.sort((a, b) => {
			const da = a.time_public || a.publishDate || '';
			const db = b.time_public || b.publishDate || '';
			return db.localeCompare(da);
		});

		// If it is empty, show a message
		if (list.length === 0) {
			document.getElementById('output-formatted').value = `No albums found for singer MID "${singerMid}".`;
			return;
		}

		let formatted = `Albums of singer ${singerMid}:\n`;

		for (const [i, album] of list.entries()) {
			const name = album.name || album.albumName;
			const mid = album.mid || album.albumMid;
			formatted += `${i + 1}. ${name} (${mid})`;
			// singer may be an array or a simple string field
			if (Array.isArray(album.singer)) {
				// output singer names with MID, join with spaces around slash
				formatted += `, ${album.singer
					.map(s => `${s.name} (${s.mid})`)
					.join(' / ')}`;
			} else if (album.singerName) {
				formatted += `, ${album.singerName}`;
			}
			// date field
			const date = album.time_public || album.publishDate;
			if (date) formatted += `, ${date}`;
			formatted += '\n';
		}
		document.getElementById('output-formatted').value = formatted;
	} catch (e) {
		console.error(e);
	}
}

async function getAlbum() {
	const albummid = document.getElementById('input').value;
	try {
		const data = await apiQuery('getAlbumInfo', { albumMid: albummid });
		document.getElementById('output').value = JSON.stringify(data, null, 2);

		// unpack the new response shape
		const resp = data.response || {};
		const info = resp.basicInfo || {};
		const company = resp.company || {};
		const singers = resp.singer?.singerList || [];

		let formatted = `Album: ${info.albumName || ''} (${info.albumMid || ''})\n`;
		formatted += ` - Release date: ${info.publishDate || ''}\n`;
		formatted += ` - Company: ${company.name || ''}\n`;
		formatted += ` - Description: ${info.desc || ''}\n`;
		formatted += ` - Genre: ${info.genreNew || info.genre || ''}\n`;

		if (singers.length) {
			formatted += ` - Singer(s): ${singers
				.map(s => `${s.name} (${s.mid})`)
				.join(' / ')}\n`;
		}

		// get the track list: prefer resp.list, else fetch via getAlbumSong()
		let songList = Array.isArray(resp.list) ? resp.list : [];
		if (!songList.length) {
			const result = await apiQuery('getAlbumSong', {
				value: albummid, num: 1000, page: 1
			});
			songList = Array.isArray(result)
				? result
				: (result.response || []);

			// Add to the output
			document.getElementById('output').value += '\n' + JSON.stringify(result, null, 2);
		}

		// sort songs by disc (index_cd) then track (index_album)
		songList.sort((a, b) => {
			const cdA = a.index_cd != null ? a.index_cd : 0;
			const cdB = b.index_cd != null ? b.index_cd : 0;
			if (cdA !== cdB) return cdA - cdB;
			const trA = a.index_album != null ? a.index_album : 0;
			const trB = b.index_album != null ? b.index_album : 0;
			return trA - trB;
		});

		if (songList.length) {
			formatted += ` - Songs (${songList.length}):\n`;
			for (const song of songList) {
				// track number: if both index_cd and index_album exist, show as "cd-album"
				let trackNo = '';
				if (song.index_cd != null && song.index_album != null) {
					trackNo = `${song.index_cd + 1}-${song.index_album}`;
				} else {
					trackNo = song.index_cd ?? song.index_album ?? '';
				}

				formatted += `   ${trackNo}. ${song.name} (${song.mid})`;

				// original title if different
				if (song.title && song.title !== song.name) {
					formatted += `, original_title: ${song.title}`;
				}
				// subtitle if present
				if (song.subtitle) {
					formatted += `, subtitle: ${song.subtitle}`;
				}
				// singers with MID
				if (song.singer) {
					const singers = Array.isArray(song.singer)
						? song.singer
						: [song.singer];
					formatted += `, singers: ${singers
						.map(s => `${s.name} (${s.mid})`)
						.join(' / ')}`;
				}
				formatted += '\n';
			}
		}

		document.getElementById('output-formatted').value = formatted;
	} catch (e) {
		console.error(e);
	}
}

async function getSong() {
	const songmid = document.getElementById('input').value;
	try {
		const data = await apiQuery('getLyricByMid', { songMid: songmid });
		document.getElementById('output').value = JSON.stringify(data, null, 2);
		// lyrics may live under response.lyric or response.data.lyric
		const lyric = data.response.lyric ?? data.response?.data?.lyric ?? '';
		document.getElementById('output-formatted').value = lyric;
	} catch (e) {
		console.error(e);
	}
}

async function getAllSongs() {
	const albummid = document.getElementById('input').value;
	const outRaw = document.getElementById('output');
	const outFmt = document.getElementById('output-formatted');
	const progress = document.getElementById('progress');
	try {
		// 1) Fetch album info
		const data = await apiQuery('getAlbumInfo', { albumMid: albummid });
		outRaw.value = JSON.stringify(data, null, 2) + '\n';

		// 2) Unpack basicInfo and track list
		const resp = data.response || {};
		const info = resp.basicInfo || {};
		let songList = Array.isArray(resp.list) ? resp.list : [];

		if (!songList.length) {
			const result = await apiQuery('getAlbumSong', { value: albummid, num: 1000, page: 1 });
			songList = Array.isArray(result) ? result : (result.response || []);
			outRaw.value += '\n' + JSON.stringify(result, null, 2);
		}

		// sort by disc then track
		songList.sort((a, b) => {
			const cdA = a.index_cd ?? 0, cdB = b.index_cd ?? 0;
			if (cdA !== cdB) return cdA - cdB;
			const trA = a.index_album ?? 0, trB = b.index_album ?? 0;
			return trA - trB;
		});

		// 3) Init formatted output & progress bar
		outFmt.value = `Lyrics for all songs in ${info.albumName || ''} (${info.albumMid || ''}):\n`;
		progress.innerHTML = '';
		const bar = document.createElement('progress');
		bar.max = songList.length;
		bar.value = 0;
		progress.appendChild(bar);

		// 4) Fetch lyrics sequentially
		for (const song of songList) {
			// wait a bit to avoid hitting API limits
			await new Promise(resolve => setTimeout(resolve, 500));

			const songMid = song.songmid || song.mid;
			const name = song.songname || song.name;
			let trackNo = '';
			if (song.index_cd != null && song.index_album != null) {
				trackNo = `${song.index_cd + 1}-${song.index_album}`;
			}

			const songData = await apiQuery('getLyricByMid', { songMid });
			outRaw.value += '\n' + JSON.stringify(songData, null, 2);
			const lyric = songData.response.lyric ?? songData.response?.data?.lyric ?? '';
			outFmt.value += `\n-- ${trackNo}. ${name} (${songMid}) --\n${lyric}\n`;
			bar.value++;
		}

		progress.removeChild(bar);
	} catch (e) {
		console.error(e);
	}
}