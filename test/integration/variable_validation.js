const path = require('path');
const test = require('tap').test;
const makeTestStorage = require('../fixtures/make-test-storage');
const readFileToBuffer = require('../fixtures/readProjectFile').readFileToBuffer;

// const renderedTarget = require('../../src/sprites/rendered-target');
const VirtualMachine = require('../../src/virtual-machine');
// const runtime = require('../../src/engine/runtime');
const sb2 = require('../../src/serialization/sb2');
const Variable = require('../../src/engine/variable');

const validateUniqueVarNames = function (t, targets) {
    targets.forEach(target => {
        const varsInScope = target.getAllVariableNamesInScopeByType(Variable.SCALAR_TYPE);
        const listsInScope = target.getAllVariableNamesInScopeByType(Variable.LIST_TYPE);
        const uniqueVarNames = new Set(varsInScope);
        const uniqueListNames = new Set(listsInScope);
        t.equal(varsInScope.length, uniqueVarNames.size);
        t.equal(listsInScope.length, uniqueListNames.size);
    });
};

const validateUniqueVarIDs = function (t, targets) {
    const allVarIds = targets.reduce((accum, target) => accum.concat(Object.keys(target.variables)), []);
    const uniqueVarIds = new Set(allVarIds);
    t.equal(allVarIds.length, uniqueVarIds.size);
};

const validateVarBlockReferences = function (t, targets) {
    targets.forEach(target => {
        const allRefs = target.blocks.getAllVariableAndListReferences();
        for (const varId in allRefs) {
            const variable = target.lookupVariableById(varId);
            t.type(variable, 'object');
            const allCurrentRefs = allRefs[varId];
            allCurrentRefs.forEach(ref => {
                t.equal(ref.referencingField.value, variable.name);
                t.equal(ref.referencingField.variableType, variable.type);
            });
        }
    });
};

test('local and global var name conflicts should be resolved', t => {
    // Get SB2 JSON (string)
    const uri = path.resolve(__dirname, '../fixtures/variable_conflicts/local_global_name_conflict.sb2');
    const project = readFileToBuffer(uri);
    // const json = extractProjectJson(uri);

    const vm = new VirtualMachine();
    // Create runtime instance & load SB2 into it
    vm. attachStorage(makeTestStorage());
    vm.loadProject(project).then(() => {
        const targets = vm.runtime.targets;
        // Validate that variable names are unique in their scopes (by type).
        validateUniqueVarIDs(t, targets);
        validateUniqueVarNames(t, targets);
        validateVarBlockReferences(t, targets);

        t.end();
    });
});

test('variables/lists with name conflict should not disappear', t => {
    // Get SB2 JSON (string)
    const uri = path.resolve(__dirname,
        '../fixtures/variable_conflicts/variable_list_name_conflict_without_variable_block.sb2');
    const project = readFileToBuffer(uri);
    // const json = extractProjectJson(uri);

    const vm = new VirtualMachine();
    // Create runtime instance & load SB2 into it
    vm. attachStorage(makeTestStorage());
    vm.loadProject(project).then(() => {
        const targets = vm.runtime.targets;
        // Validate that variable names are unique in their scopes (by type).
        validateUniqueVarIDs(t, targets);
        validateUniqueVarNames(t, targets);
        validateVarBlockReferences(t, targets);
        t.equal(Object.keys(targets[1].variables).length, 2);

        t.end();
    });
});

test('variable and list name conflicts should be resolved', t => {
    // Get SB2 JSON (string)
    const uri = path.resolve(__dirname, '../fixtures/variable_conflicts/variable_list_name_conflict.sb2');
    const project = readFileToBuffer(uri);
    // const json = extractProjectJson(uri);

    const vm = new VirtualMachine();
    // Create runtime instance & load SB2 into it
    vm. attachStorage(makeTestStorage());
    vm.loadProject(project).then(() => {
        const targets = vm.runtime.targets;
        // Validate that variable names are unique in their scopes (by type).
        validateUniqueVarIDs(t, targets);
        validateUniqueVarNames(t, targets);
        validateVarBlockReferences(t, targets);

        t.end();
    });
});

test('')
