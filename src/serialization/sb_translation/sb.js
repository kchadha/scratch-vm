/**
 * @fileoverview
 * Import an sb file.
 * Parses provided sb data buffer and then generates all needed
 * scratch-vm runtime structures.
 */

const SmartBuffer = require('smart-buffer').SmartBuffer;
const log = require('../../util/log');
// const defaultOneBitColorMap = require('./color_map').defaultOneBitColorMap;
// const defaultColorMap = require('./color_map').defaultColorMap;

class Ref {
    constructor (i) {
        this.index = i - 1;
    }

    toString () {
        return JSON.stringify(this);
    }
}

class SBParser {
    constructor (input) {
        // Validate Input
        /* eslint-disable no-undef */
        if (!(input instanceof ArrayBuffer ||
              Buffer.isBuffer(input) ||
              typeof input === 'string')) { // TODO handle strings... or don't accept them at all...
            throw new Error('Could not construct SBParser. Input file must be a buffer or a string.');
        }

        if (input instanceof ArrayBuffer) {
            input = new Buffer(input);
        }
        /* eslint-enable no-undef */

        this.data = SmartBuffer.fromBuffer(input);
        this.targets = {};
        this.costumes = {};
        this.sounds = {};
        this.objTable = this.parseSB();
    }

    static get OBJ_REF () {
        return 99;
    }

    obj (classID, objData, optClassVersion, optFields) {
        return {
            classID: classID,
            className: objData && objData.className ? objData.className : '',
            objData: objData && objData.data ? objData.data : objData, // maybe {} if not provided...?
            classVersion: optClassVersion, // undefined if fixed format or number
            fields: optFields
        };
    }

    parseSB () {
        const data = this.data;

        // Validate project header
        if (data.length < 10) {
            throw new Error('Invalid Scratch 1.4 project. Not enough bytes.');
        }
        const header = data.readString(10);
        console.log('Header: ' + header);
        if (header !== 'ScratchV01' && header !== 'ScratchV02') {
            throw new Error('Input is not valid Scratch 1.4 project.');
        }

        // Read the content length (but we don't need to use the data,
        // so no need to save it to a variable)
        data.readInt32BE(); // TODO 2249

        const objTable = this.parseObjectTable();
        console.log(`Done! Obj Table: ${JSON.stringify(objTable)}`);

    }

    parseObjectTable () {
        const data = this.data;
        // Read object table...
        // TODO confirm that action script and JS handle '||' the same way.
        // Does RHS get evaluated if LHS evaluates to true?
        if (data.readString(4) !== 'ObjS' || data.readBuffer(1)[0] !== 1) {
            throw new Error('Input is not a valid Scratch 1.4 project.');
        }
        if (data.readString(4) !== 'Stch' || data.readBuffer(1)[0] !== 1) {
            throw new Error('Input is not a valid Scratch 1.4 project.');
        }

        const objCount = data.readInt32BE();
        const objTable = [];
        for (let i = 0; i < objCount; i++) {
            objTable[i] = this.parseObj();
        }
        return objTable;
    }

    parseObj () {
        const data = this.data;
        // Read unsigned byte
        const classId = data.readUInt8();
        let result = null;
        if (classId < SBParser.OBJ_REF) {
            result = this.obj(classId, this.parseFixedFormat(classId));
        } else {
            const classVersion = data.readUInt8();
            const fieldCount = data.readUInt8();
            const fields = [];
            for (let i = 0; i < fieldCount; i++) {
                fields[i] = this.parseField();
            }
            result = this.obj(classId, null, classVersion, fields);
        }
        return result;
    }

    parseScratchLargeInt () {
        const data = this.data;
        let num = 0.0;
        let multiplier = 1.0;
        const count = data.readInt16BE();
        for (let i = 0; i < count; i++) {
            num = num + (multiplier * data.readUInt8());
            multiplier = multiplier * 256.0;
        }
        return num;
    }
    parseFields (num) {
        const arr = []
        for (let i = 0; i < num; i++) {
            arr.push(this.parseField());
        }
        return arr;
    }
    parseField () {
        const data = this.data;
        const classId = data.readUInt8();
        if (classId === SBParser.OBJ_REF) {
            let i = data.readUInt8() << 16;
            i += data.readUInt8() << 8;
            i += data.readUInt8();
            return new Ref(i);
        }
        return this.parseFixedFormat(classId);
    }

    parseFixedFormat (classId) {
        const data = this.data;
        // Read the data according to the given class id
        // (a prefix before a piece of data describing what's to come -- and therefore
        // how to read it)
        // The comments below provide a short explanation of what the data is based
        // on its class id
        switch (classId) {
        case 1: // Null/undefined
            log.info('ClassID: 1 -- returning null');
            return {
                className: 'null/undefined',
                data: null
            };
        case 2: // True
            log.info('ClassID: 2 -- returning true');
            return {
                className: 'boolean',
                data: true
            };
        case 3: // False
            log.info('ClassID: 3 -- returning false');
            return {
                className: 'boolean',
                data: false
            };
        case 4: // Small Integer
            log.info('ClassID: 4 -- reading Int');
            return {
                className: 'small int',
                data: data.readInt32BE()
            };
        case 5: // Small Integer 16
            return {
                className: 'small int 16',
                data: data.readInt16BE()
            };
        case 6: // Large Positive Integer
        case 7: // Large Negative Integer
            return {
                className: 'large int',
                data: this.parseScratchLargeInt()
            };
        case 8: // double/float
            return {
                className: 'double/float',
                data: data.readDoubleBE()
            }; // TODO do we need to ensure that this is actually a float?
        case 9: // String
        case 10: { // Symbol
            // Read a string
            // First figure out how long it is
            const count = data.readInt32BE();
            return {
                className: 'string/symbol',
                data: data.readString(count)
            };
        }
        case 11: { // Byte Array
            const count = data.readInt32BE();
            let bytes = new ArrayBuffer(); // TODO need to figure out what to do w/buffers vs. array buffers
            if (count > 0) bytes = data.readBuffer(count); // returns a buffer
            return {
                className: 'byte array',
                data: bytes
            };
        }
        case 12: { // Sound Buffer
            const count = data.readInt32BE();
            let bytes = new ArrayBuffer(); // TODO need to figure out what to do w/buffers vs. array buffers
            if (count > 0) bytes = data.readBuffer(2 * count);
            return {
                className: 'sound buffer',
                data: bytes
            };
        }
        case 13: { // bitmap
            const count = data.readInt32BE();
            const objList = new Array(count);
            for (let i = 0; i < count; i++) {
                objList[i] = data.readUInt32BE();
            }
            return {
                className: 'bitmap',
                data: objList
            };
        }
        case 14: { // UTF-8
            const count = data.readInt32BE();
            return {
                className: 'utf-8 string',
                data: data.readString(count)
            };
        }
        case 20: // Array
        case 21: // Ordered Collection
        case 22: // Set
        case 23: { // Identity Set
            const count = data.readInt32BE();
            return {
                className: 'array/collection',
                data: this.parseFields(count)
            };
        }
        case 24: // Dictionary
        case 25: { // Identity Dictionary
            const count = data.readInt32BE();
            return {
                className: 'dictionary',
                data: this.parseFields(2 * count)
            };
        }
        case 30: // Color
        case 31: { // Translucent Color
            const rgb = data.readInt32BE();
            const alpha = (classId === 31) ? data.readUInt8() : 0xFF; // 0xFF = 255
            const r = (rgb >> 22) & 0xFF;
            const g = (rgb >> 12) & 0xFF;
            const b = (rgb >> 2) & 0xFF;
            return {
                className: 'color',
                data: (alpha << 24) | (r << 16) | (g << 8) | b
            };
        }
        case 32: { // Point
            return {
                className: 'point',
                data: this.parseFields(2)
            };
        }
        case 33: { // Rectangle
            return {
                className: 'rectangle',
                data: this.parseFields(4)
            };
        }
        case 34: // Form (black and white image (?))
        case 35: { // Squeak Image (color image)
            const numFields = classId === 35 ? 6 : 5; // 6th field is the color map for color images
            return {
                className: 'image',
                data: {
                    width: this.parseField(),
                    height: this.parseField(),
                    depth: this.parseField(),
                    empty: this.parseField(),
                    pixelArrayRef: this.parseField(),
                    colorMapArrayRef: numFields === 6 ? this.parseField() : null
                }
                // this.parseFields(numFields)
                // fields // TODO might as well just call decodeSqueakImage right here (maybe async)
            };
        }
        default:
            throw new Error(`Unknown fixed format class: ${classId}`);
        }
    }

    // decodeSqueakImage(imageObj) {
    //     // TODO Create a new Rectangle
    //
    //     // Locate the pixel array in the object table using the pixel array ref
    //     const imagePixels = objTable[imageObj.pixelArrayRef.index].data;
    //
    //     const depth = imageObj.depth;
    //     // TODO Check if this is available on all browsers we support
    //     const raster = this.decodePixels(imagePixels, depth === 32);
    //
    //     // TODO bitmap data...
    //
    //     if (depth <= 8) {
    //         const colorMap = depth === 1 ? defaultOneBitColorMap : defaultColorMap;
    //         if (imageObj.colorMapArrayRef) {
    //             const colorArray = objTable[imageObj.colorMapArrayRef.index].data;
    //             const colorMap = buildCustomColorMap(depth, colorArray);
    //         }
    //     }
    //     if (depth === 16) {
    //
    //     }
    //     if (depth === 32) {
    //
    //     }
    //     // Action Script code replaces image obj data with the following
    //     Promise.resolve(bmpData);
    // }
    //
    // decodePixels(pixelArray, addAlpha) {
    //     // TODO
    //     return null;
    // }
    //
    // buildCustomColorMap(depth, colorArray) {
    //     // TODO
    //     return null;
    // }
}

module.exports = SBParser;
