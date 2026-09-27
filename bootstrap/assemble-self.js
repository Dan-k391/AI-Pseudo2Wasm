import { assembleSelfHosted as assemblePortable } from '../src/selfhost.js';

export const assembleSelfHosted = (ir, assembler) => assemblePortable(ir, assembler);
