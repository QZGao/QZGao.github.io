/**
 * Parses a wikitext template instance into an object.
 * @param {string} wikitext - Entire page or snippet containing the template.
 * @param {string} templateName - Name of the template (without braces).
 * @returns {Object|null} - Object with { name, params } or null if not found.
 */
const parseTemplate = function (wikitext, templateName) {
    // 1. Locate the template start
    const startPattern = new RegExp(`{{\\s*${templateName}\\s*(\\||}})`, 'i');
    const match = startPattern.exec(wikitext);
    if (!match) return null;

    // 1.a Empty‐template shortcut
    if (match[1] === '}}') {
        return {name: templateName, params: {}};
    }

    let idx = match.index + match[0].length;
    let level = 0;
    let buffer = '';
    let key = null;
    let params = {};
    let unnamedCount = 0;
    let closed = false;                     // ← track whether we actually saw the closing

    // Helper to flush the current buffer into params
    function flush() {
        const value = buffer.trim();
        if (value === '') {
            buffer = '';
            key = null;
            return;
        }

        if (key !== null) {
            // named param
            params[key] = value;
        } else {
            // unnamed → numeric
            unnamedCount += 1;
            params[String(unnamedCount)] = value;
        }

        buffer = '';
        key = null;
    }

    // 2. Scan forward until we close the main template
    while (idx < wikitext.length) {
        if (wikitext.startsWith('{{', idx)) {
            level++;
            buffer += '{{';
            idx += 2;
        } else if (wikitext.startsWith('[[', idx)) {
            level++;
            buffer += '[[';
            idx += 2;
        } else if (wikitext.startsWith('}}', idx)) {
            if (level === 0) {
                flush();
                closed = true;                    // ← mark success
                break;
            }
            level--;
            buffer += '}}';
            idx += 2;
        } else if (wikitext.startsWith(']]', idx)) {
            // only decrement when inside a nested block
            if (level > 0) {
                level--;
            }
            buffer += ']]';
            idx += 2;
        } else if (wikitext[idx] === '|' && level === 0) {
            flush();
            idx++;
        } else if (wikitext[idx] === '=' && level === 0 && key === null) {
            key = buffer.trim();
            buffer = '';
            idx++;
        } else {
            buffer += wikitext[idx++];
        }
    }

    // 3. If we ran out of text without ever closing, it's a parse failure
    if (!closed) return null;

    return {name: templateName, params};
}

module.exports = parseTemplate;
