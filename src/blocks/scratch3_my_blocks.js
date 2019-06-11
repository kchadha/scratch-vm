const BlockType = require('../extension-support/block-type');
const ArgumentType = require('../extension-support/argument-type');
const xmlEscape = require('../util/xml-escape');

/**
 * An example core block implemented using the extension spec.
 * This is not loaded as part of the core blocks in the VM but it is provided
 * and used as part of tests.
 */
class Scratch3Procedures {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;
    }

    /**
     * @returns {object} metadata for this extension and its blocks.
     */
    getInfo () {
        const info = {
            id: 'customBlocks',
            name: 'Custom Blocks', // TODO use formatMessage so that this can be translated
            dynamicCategoryCallbackKey: 'PROCEDURE_EXTENSION',
            blocks: [
                {
                    // TODO eventually we'll define this here,
                    // but for now use the provided `MAKE_A_PROCEDURE` button callback
                    func: 'MAKE_A_PROCEDURE',
                    blockType: BlockType.BUTTON,
                    text: 'Make a Block'
                }
            ]
        };
        const editingTarget = this.runtime.getEditingTarget();
        if (!editingTarget) {
            return info;
        }

        const blocks = editingTarget.blocks;

        const procedureNames = blocks.getAllProcedureDefinitions();
        procedureNames.forEach(name => {
            const paramInfo = blocks.getProcedureParamNamesIdsAndDefaults(name);
            const procPrototype = blocks.getBlock(blocks.getProcedureDefinition(name));
            const warp = JSON.parse(procPrototype.mutation.warp);
            paramInfo.push(warp);
            info.blocks.push(this.createBlockInfo(name, paramInfo));
        });

        return info;
    }

    createBlockInfo (name, paramInfo) {
        // TODO CANT USE THE LINE BELOW BECAUSE WE HAVEN'T UPDATED THE DEFINITION YET AND THE VM
        // DOESN'T KNOW ABOUT THE NEW BLOCK
        // const paramInfo = editingTarget.blocks.getProcedureParamNamesIdsAndDefaults(name);
        const [paramNames, paramIds, paramDefaults, warp] = paramInfo;
        let generateShadows = false;
        if (paramInfo.length === 5) {
            generateShadows = paramInfo[4];
        }

        const [procName, inputNames, paramTypes] = this._translateProcName(name, paramIds);

        const args = {};

        for (let i = 0; i < inputNames.length; i++) {
            const inputName = inputNames[i];
            args[inputName] = {
                type: paramTypes[i],
                defaultValue: paramTypes[i] === ArgumentType.Boolean ? false : ''
            };
        }

        return {
            opcode: 'call',
            blockType: BlockType.COMMAND,
            isDynamic: true,
            text: procName,
            arguments: args,
            proccode: name,
            argumentNames: paramNames,
            argumentDefaults: paramDefaults,
            argumentIds: paramIds,
            generateShadows: generateShadows,
            warp: warp,
            inputNames: inputNames,
            customContextMenu: [
                {
                    name: 'Edit', // TODO translation
                    builtInCallback: 'EDIT_A_PROCEDURE',
                    callback: 'editCallback'
                }
            ]
        };
    }


    editCallback ({oldProccode, mutation}) {
        console.log("Proccode ", mutation);

        if (this.runtime && this.runtime.updateBlockOnCurrentWorkspace) {
            console.log("Hooray!");
            // Get all the procedure calls for this proccode
            const editingTarget = this.runtime.getEditingTarget();
            if (!editingTarget) return;

            // TODO NEED OLD PROCCODE TOO...

            const newProccode = mutation.getAttribute('proccode');

            const callBlockIds = editingTarget.blocks.getAllProcedureCalls(oldProccode);

            const argumentNames = JSON.parse(mutation.getAttribute('argumentnames'));
            const argumentIds = JSON.parse(mutation.getAttribute('argumentids'));
            const argumentDefaults = JSON.parse(mutation.getAttribute('argumentdefaults'));
            const generateShadows = JSON.parse(mutation.getAttribute('generateshadows'));
            const warp = JSON.parse(mutation.getAttribute('warp'));

            const paramInfo = [argumentNames, argumentIds, argumentDefaults, warp, generateShadows];
            const newBlockInfo = this.createBlockInfo(newProccode, paramInfo);

            for (const callBlockId of callBlockIds) {
                // Update each of the call blocks
                this.runtime.updateBlockOnCurrentWorkspace(callBlockId, newBlockInfo);
                // TODO THE VM DOESN'T KNOW ABOUT THESE CHANGES...
            }
            mutation.setAttribute('blockInfo', JSON.stringify(newBlockInfo)); // xml-escaping this one actually breaks things....
        }

    }

    _translateProcName (name, argumentIds) {
        const inputNames = [];
        const types = [];
        let index = 0;
        const newName = name.replace(/%b|%s/g, c => {
            switch (c) {
            case '%b': {
                types.push(ArgumentType.BOOLEAN);
                // TODO need to decide between this [Input0] vs. using uids
                // the way the VM works rn...
                // const inputName = `Input${index}`;
                // index++;
                // inputNames.push(inputName);
                const inputName = argumentIds[index];
                inputNames.push(inputName);
                index++;
                return `[${inputName}]`;
            }
            case '%s': {
                types.push(ArgumentType.STRING);
                // const inputName = `Input${index}`;
                // index++;
                // inputNames.push(inputName);
                const inputName = argumentIds[index];
                inputNames.push(inputName);
                index++;
                return `[${inputName}]`;
            }
            default: return c;
            }
        });

        return [newName, inputNames, types];
    }
    /* procInfo
        {
            name: 'procedure name with args [input0] [input1] [input2] in the middle.',
            args: [
                {
                    id: input0,
                    argName: 'first input',
                    type: 's'
                },
                {
                    id: input1,
                    argName: 'second input',
                    type: 'b'
                },
                {
                    id: input2,
                    argName: 'third input'
                    type: 's'
                }
            ]

            OR

            args: {
                input0: {
                    type: ArgumentType.String,
                    argName: 'first input'
                },
                input1: {
                    type: ArgumentType.Boolean,
                    argName: 'second input'
                },
                input2: {
                    type: ArgumentType.String,
                    argName: 'third input'
                }
            }
        }
    */


    makeABlock () {
        // No-op
        // Eventually will be responsible for putting a definition hat on the workspace
        // or triggering the extension manager to do that.
    }

    definition () {
        // No-op: execute the blocks.
    }

    call (args, util, blockInfo) {
        if (!util.stackFrame.executed) {
            const procedureCode = blockInfo.proccode;
            const paramNamesIdsAndDefaults = util.getProcedureParamNamesIdsAndDefaults(procedureCode);

            // If null, procedure could not be found, which can happen if custom
            // block is dragged between sprites without the definition.
            // Match Scratch 2.0 behavior and noop.
            if (paramNamesIdsAndDefaults === null) {
                return;
            }

            const [paramNames, _, paramDefaults] = paramNamesIdsAndDefaults;

            // Initialize params for the current stackFrame to {}, even if the procedure does
            // not take any arguments. This is so that `getParam` down the line does not look
            // at earlier stack frames for the values of a given parameter (#1729)
            util.initParams();

            for (let i = 0; i < blockInfo.inputNames.length; i++) {
                if (args.hasOwnProperty(blockInfo.inputNames[i])) {
                    util.pushParam(paramNames[i], args[blockInfo.inputNames[i]]);
                } else {
                    util.pushParam(paramNames[i], paramDefaults[i]);
                }
            }

            util.stackFrame.executed = true;
            util.startProcedure(procedureCode);
        }
    }
}

/* Notes:
    - vm should track the procedure info on each target
    - extension should use target's procedure info to populate the toolbox
    - making a block should automatically put the procedure definition on the
      workspace and the caller in the toolbox

*/

module.exports = Scratch3Procedures;
