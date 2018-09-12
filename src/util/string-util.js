class StringUtil {
    static withoutTrailingDigits (s) {
        let i = s.length - 1;
        while ((i >= 0) && ('0123456789'.indexOf(s.charAt(i)) > -1)) i--;
        return s.slice(0, i + 1);
    }

    static unusedName (name, existingNames) {
        if (existingNames.indexOf(name) < 0) return name;
        name = StringUtil.withoutTrailingDigits(name);
        let i = 2;
        while (existingNames.indexOf(name + i) >= 0) i++;
        return name + i;
    }

    /**
     * Split a string on the first occurrence of a split character.
     * @param {string} text - the string to split.
     * @param {string} separator - split the text on this character.
     * @returns {string[]} - the two parts of the split string, or [text, null] if no split character found.
     * @example
     * // returns ['foo', 'tar.gz']
     * splitFirst('foo.tar.gz', '.');
     * @example
     * // returns ['foo', null]
     * splitFirst('foo', '.');
     * @example
     * // returns ['foo', '']
     * splitFirst('foo.', '.');
     */
    static splitFirst (text, separator) {
        const index = text.indexOf(separator);
        if (index >= 0) {
            return [text.substring(0, index), text.substring(index + 1)];
        }
        return [text, null];

    }

    /**
     * Strip control characters out of the string by replacing them with the empty string.
     * CC-BY-SA: Rory O'Kane
     * https://stackoverflow.com/questions/26741455/how-to-remove-control-characters-from-string
     * @param {!string} unsafe Unsafe string possibly containing unicode control characters.
     * @return {string} String with control characters removed.
     */
    static stripControlChars (unsafe) {
        return unsafe.replace(/[\x00-\x1F\x7F-\x9F]/g, ''); /* eslint-disable-line no-control-regex */
    }
}

module.exports = StringUtil;
