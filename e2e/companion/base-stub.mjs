// A stand-in for @companion-module/base: records what a module declares and
// sends, so a scenario can drive its actions and read its feedbacks without a
// Companion host.
export const InstanceStatus = {
  Ok: 'ok',
  Connecting: 'connecting',
  Disconnected: 'disconnected',
  ConnectionFailure: 'connection_failure',
  BadConfig: 'bad_config',
  UnknownError: 'unknown_error',
  UnknownWarning: 'unknown_warning',
};
export function combineRgb(r, g, b) {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}
export class InstanceBase {
  constructor() {
    this.__actions = {};
    this.__feedbacks = {};
    this.__presets = null;
    this.__variableDefs = {};
    this.__variables = {};
    this.__variableSets = 0;
    this.__variableValueCalls = 0;
    this.__checked = [];
    this.__logs = [];
    this.__status = [];
  }
  get label() {
    return 'showtrak';
  }
  get id() {
    return 'test-instance';
  }
  setActionDefinitions(defs) {
    this.__actions = defs;
  }
  setFeedbackDefinitions(defs) {
    this.__feedbacks = defs;
  }
  setPresetDefinitions(structure, presets) {
    this.__presets = { structure, presets };
  }
  setVariableDefinitions(defs) {
    this.__variableDefs = defs;
    this.__variableSets++;
  }
  setVariableValues(values) {
    this.__variableValueCalls++;
    Object.assign(this.__variables, values);
  }
  getVariableValue(id) {
    return this.__variables[id];
  }
  checkFeedbacks(...ids) {
    this.__checked.push(...ids);
  }
  checkAllFeedbacks() {
    this.__checked.push('*');
  }
  checkFeedbacksById(...ids) {
    this.__checked.push(...ids);
  }
  updateStatus(status, message) {
    this.__status.push([status, message ?? null]);
  }
  log(level, message) {
    this.__logs.push([level, message]);
  }
}
export function runEntrypoint() {}
