/**
 * Everything project mode needs at run time, in one module so the app can
 * load it on demand: nobody who never opens a LaTeX project downloads it.
 */
export { loadProject, access, exportProject, modifiedPaths, ProjectError } from './project';
export { parseDocument } from './document';
export { decodeDiagram, documentStyle, planInsert, planRemove, planReplace, slugLabel } from './figure';
