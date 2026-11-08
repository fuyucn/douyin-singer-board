import crypto from "crypto";
import { gunzip } from "zlib";
import { get_sign } from "./webmssdk.js";
export function getUserUniqueId() {
    return (Math.floor(Math.random() * (7999999999999999999 - 7300000000000000000)) + 7300000000000000000).toString();
}
export function getXMsStub(params) {
    const sigParams = Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
    return crypto.createHash("md5").update(sigParams).digest("hex");
}
export function getSignature(xMsStub) {
    try {
        return get_sign(xMsStub);
    }
    catch {
        return "00000000";
    }
    return "00000000";
}
export function decompressGzip(buffer) {
    return new Promise((resolve, reject) => {
        gunzip(buffer, (err, result) => (err ? reject(err) : resolve(result)));
    });
}
