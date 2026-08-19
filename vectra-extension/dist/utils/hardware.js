"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHardwareSnapshot = getHardwareSnapshot;
const os = __importStar(require("node:os"));
const gpu_1 = require("./gpu");
/** Combines existing GPU probing with new, cheap, synchronous CPU/RAM reads for hardware-aware model recommendations. */
async function getHardwareSnapshot() {
    const gpus = await (0, gpu_1.detectGpus)();
    const vramValues = gpus.map((gpu) => gpu.vramMiB).filter((value) => typeof value === 'number');
    return {
        gpus,
        maxVramMiB: vramValues.length ? Math.max(...vramValues) : undefined,
        cpuCores: os.cpus().length,
        totalRamMiB: Math.round(os.totalmem() / 1024 / 1024),
        platform: process.platform
    };
}
//# sourceMappingURL=hardware.js.map