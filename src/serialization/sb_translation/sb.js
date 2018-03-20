/**
 * @fileoverview
 * Import an sb file.
 * Parses provided sb data buffer and then generates all needed
 * scratch-vm runtime structures.
 */

const SmartBuffer = require('smart-buffer').SmartBuffer;
// const Bitmap = require('imagejs').Bitmap;
const log = require('../../util/log');
const Variable = require('../../engine/variable');
const defaultOneBitColorMap = require('./color_map').defaultOneBitColorMap;
const defaultColorMap = require('./color_map').defaultColorMap;

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
        // this.targets = {};
        // this.costumes = {};
        // this.sounds = {};
        this.parseSBHeader();
        this.projectInfoObjectTable = this.parseObjectTable();
        // console.log(`Done! Obj Table: ${JSON.stringify(objTable)}`);

        this.contentObjectTable = this.parseObjectTable();
        // this.fixReferences();

        // this.targets = this.parseProject();

    }

    static get OBJ_REF () {
        return 99;
    }

    static get EPSILON () {
        return 1 / 4294967296;
    }

    obj (classId, objData, optClassVersion, optFields) {
        return {
            classId: classId,
            className: objData && objData.className ? objData.className : '',
            objData: objData && objData.hasOwnProperty('data') ?
                objData.data : objData, // maybe {} if not provided...?
            classVersion: optClassVersion, // undefined if fixed format or number
            fields: optFields
        };
    }

    parseSBHeader () {
        const data = this.data;

        // Validate project header
        if (data.length < 10) {
            throw new Error('Invalid Scratch 1.4 project. Not enough bytes.');
        }
        const header = data.readString(10);
        if (header !== 'ScratchV01' && header !== 'ScratchV02') {
            throw new Error('Input is not valid Scratch 1.4 project.');
        }

        // Read the content length (but we don't need to use the data,
        // so no need to save it to a variable)
        data.readInt32BE(); // TODO 2249

        // Moving these up
        // const objTable = this.parseObjectTable();
        // console.log(`Done! Obj Table: ${JSON.stringify(objTable)}`);
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
        let objTable = [];
        for (let i = 0; i < objCount; i++) {
            objTable[i] = this.parseObj(objTable);
        }

        objTable = objTable.map(o => this.decodeSqueakImage(o));
        objTable = this.fixReferences(objTable);

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

            let objData = null;
            if (classId === 124 || classId === 125 || classId === 155 ||
                classId === 162 || classId === 164 || classId === 175) {
                objData = {};
            }

            result = this.obj(classId, objData, classVersion, fields);
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
        const arr = [];
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
        return this.obj(classId, this.parseFixedFormat(classId));
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
                data: data.readDoubleBE() + SBParser.EPSILON // TODO maybe we need to check if this is an int first
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

    decodeSqueakImage (o) {
        return o; // TODO fill this in
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
    //     const bmpData = new Bitmap({
    //         width: imageObj.width,
    //         height: imageObj.height
    //     });
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

    fixReferences (objTable) {
        // Note: This function relies on earlier modifications of the array being
        // affected by later modifications of the array (e.g. by later iterations of the loop)
        // e.g. recall that if you have nested refs like the following:
        // objTable = [
        //     [Ref(2)],
        //     ['someData', 7, null, true},
        //     [Ref(3), Ref(5)],
        //     [Ref(4)],
        //     [8, 9, 10],
        //     ['world']
        // ]
        //
        // executing the following lines of code:
        // objTable[0][0] = objTable[2];
        // objTable[2][0] = objTable[3];
        // objTable[2][1] = objTable[5];
        // objTable[3][0] = objTable[4];
        //
        // the resulting array will be:
        // objTable = [
        //     [[[[8, 9, 10]] , ['world']]],
        //     ['someData', 7, null, true],
        //     [[[8, 9, 10]] ,  ['world']],
        //     [[8, 9, 10]]
        //     [8, 9, 10]
        //     ['world']
        // ]
        // The main thing to note here, and the reason for this comment is that
        // since the array is being modified in place, and because JavaScript is
        // 'call by sharing' (http://jasonjl.me/blog/2014/10/15/javascript/),
        // assigning an earlier value in the object table to a later value
        // e.g. objTable[0] = objTable[3]
        // means that later changes to objTable[3] will also change objTable[0]
        // because objTable[0] is referring to a the reference for objTable[3]
        // and not a copy of the value objTable[3] at the point in time that it
        // was assigned to objTable[0].
        // This means that this fixReferences function is able to *completely*
        // dereference all the 'Ref' objects in the objTable (including nested references
        // like in the example above) without the use of any recursive calls.

        // Go through object references that store references to other objects
        // in the table and dereference them

        for (const i in objTable) {
            const currObj = objTable[i];
            const currClassId = currObj.classId;
            if ((currClassId >= 20) && (currClassId <= 29)) {
                // These are collection elements

                // Right now, these collections contain refs to other objects
                // in the object table, dereference these.
                const collection = currObj.objData;
                for (const j in collection) {
                    const el = collection[j];
                    if (el instanceof Ref) collection[j] = this.deRef(el, objTable);
                }
                objTable[i].objData = collection;

                // The following does not work (to replace the above)
                //
                // let collection = currObj.objData;
                // collection = collection.map(el => deRefIfRef(el));
                // objTable[i].objData = collection;
                //
                // Even though this commented out block recognizes that map
                // returns a modified copy of the original array, and accounts
                // for that fact by re-assigning the collection object, this
                // code does not work because the mapped function is not acting
                // on the objTable sub-data directly, but rather a copy of it
                // created by the map function (e.g. there's two kinds of
                // copying going on there)
            }
            if (currClassId > SBParser.OBJ_REF) {
                // De-reference the fields of a 'user-defined' Scratch Object..
                const currObjFields = currObj.fields;
                for (const j in currObjFields) {
                    const el = currObjFields[j];
                    if (el instanceof Ref) currObjFields[j] = this.deRef(el, objTable);
                }
                objTable[i].fields = currObjFields;
            }

        }
        return objTable;
    }

    /**
     * De-reference the given Ref object in the given object table.
     * If the object table entry referenced by the current Ref object
     * has null objData, return the entire entry object. Otherwise
     * return the contents of the entry's objData field.
     *
     * @param {Ref} r The reference object to de-reference
     * @param {Array} objTable The object table to look up the object referenced by r
     * @return {object} The de-referenced object
     */
    deRef (r, objTable) {
        const referencedEntry = objTable[r.index];
        return (referencedEntry.objData === null) ? referencedEntry : referencedEntry.objData;
    }
}

class SBToSB3 {
    constructor (sbParser) {
        this.targets = this.parseProject(sbParser.contentObjectTable);
    }

    parseProject (objTable) {
        // TODO record sprite names
        this.recordSpriteNames();

        const targets = new Array();
        targets.push(this.parseStage(objTable[0])); // Stage should be first element in contentObjectTable

        const sprites = objTable.filter(el => (el.classId === 124));

        const spriteTargets = sprites.map(spr => this.parseSprite(spr));
        // this.targets = targets;
        return targets.concat(spriteTargets);
        // stage.
    }

    parseStage (stageEntry) {
        if (stageEntry.classId !== 125) {
            throw new Error('First object in content object table should be stage.');
        }

        // const stage = Object.create(null);

        const stage = this.parseTarget(stageEntry);

        // stage.name = stageEntry.fields[6];
        // In Scratch 1.4, users can feasibly change the stage name through the code
        stage.isStage = true;

        // if (stageEntry.fields.length > 16) // TODO record Sprite library order
        if (stageEntry.fields.length > 18) stage.tempoBPM = stageEntry.fields[18].data;
        if (stageEntry.fields.length > 20) {
            // TODO fill out buildLists
            stage.variables = stage.variables.concat(this.buildLists(stageEntry.fields[20]));
        }

        return stage;

    }

    // Parsing common to stage and sprite
    parseTarget (targetEntry) {
        const target = Object.create(null);
        target.name = targetEntry.fields[6];
        target.variables = this.buildVars(targetEntry.fields[7]);
        target.scripts = this.buildScripts(targetEntry.fields[8]); // TODO define this
        target.scriptComments = this.buildComments(targetEntry.fields[8]); // TODO define this
        this.fixCommentRefs(target.scriptComments, target.scripts); // TODO define this
        // TODO set media..... fields[10], fields[11] (costumes and sounds and current costume)
        return target;
    }

    parseSprite (spriteEntry) {
        const spriteFields = spriteEntry.fields;
        const sprite = this.parseTarget(spriteEntry);

        sprite.visible = (spriteFields[4].data && 1) === 0;
        // sprite.scaleX = sprite.scaleY = spriteFields[13][0].data;
        sprite.size = Math.round(spriteFields[13][0].data * 100);
        sprite.rotationStyle = this.translateRotationStyle(spriteFields[15]); // TODO make this static
        const dir = Math.round(spriteFields[14].data * 1000000) / 1000000;
        sprite.direction = dir - 270; // TODO see complicated direction calculation in scratch 2 code

        sprite.isDraggable = spriteFields.length > 18 ? spriteFields[18].data : false;
        if (spriteFields.length > 20) {
            sprite.variables = sprite.variables.concat(this.buildLists(spriteFields[20]));
        }

        // TODO sprite x y

        return sprite;

    }

    recordSpriteNames () {
        const objTable = this.contentObjectTable;

        for (const i in objTable) {
            const currObj = objTable[i];
            const currClassId = currObj.classId;
            if (currClassId === 124) {
                // Start creating a new target...
                if (currObj.objData) {
                    // Sprite Name is @ index 6 of the obj fields array
                    objTable[i].objData.name = currObj.fields[6];
                }
                // objTable[i].objData ? objTable[i].objData.name;
            }
        }
    }

    // TODO make this static
    translateRotationStyle (sb1RotationStyle) {
        switch (sb1RotationStyle) {
        case 'normal':
            return 'all around';
        case 'leftRight':
            return 'left-right';
        case 'none':
            return 'don\'t rotate';
        default:
            return 'all around';
        }
    }

    // TODO this can be static
    buildVars (pairs) {
        if (pairs === null) return [];
        const variables = [];
        for (let i = 0; i < pairs.length - 1; i += 2) {
            variables.push({
                name: pairs[i],
                type: Variable.SCALAR_TYPE,
                value: pairs[i + 1]
            });
        }
        return variables;
    }

    buildLists (pairs) {
        if (pairs === null) return [];
        const lists = [];
        // for (let i = 0; i < pairs.length - 1; i += 2) {

        // }
        // TODO watchers
        console.log('TODO: watchers');
        return lists;
    }

    // scriptsObj is an array of stacks of blocks on a given sprite's workspace
    // each stack is also an array (of arrays) of the form:
    // [[x,y] [blocks]]
    // where the first element of the stack is a 2-element array representing
    // the x-y position on the workspace of the top-level block in the stack
    // the second element of the stack is an array of blocks in the stack
    buildScripts (scriptsObj) {
        if (!Array.isArray(scriptsObj[0])) return [];
        const result = [];
        for (const i in scriptsObj) {
            const stack = scriptsObj[i];
            // Before we do anything, make sure that the 'stack of blocks'
            //  is not actually just a comment.
            // If it is, skip it for now and move on to the next stack
            const topOfStack = stack[1][0];
            if (topOfStack && (topOfStack[0] === 'scratchComment')) continue; // skip comments
            const topBlock = this.sbBlockArrayToStack(stack[1]);
            topBlock.topLevel = true;
            topBlock.x = stack[0][0].objData;
            topBlock.y = stack[0][1].objData;
            result.push(topBlock);
        }
        return result;
    }

    sbBlockArrayToStack (blockArray) {
        return {};
        // TODO figure out what to do here. Seems like the quickest (but less ideal)
        // option is to translate this to sb2 using the action script code as a
        // reference and then calling the sb2 parser on it...
    }

    buildComments (thing) { return null; }
    fixCommentRefs (thing1, thing2) { return null; }
}

module.exports = {
    SBParser: SBParser,
    SBToSB3: SBToSB3
};
