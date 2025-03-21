"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidForecastArgs = isValidForecastArgs;
// 类型保护函数，用于检查 GetForecastArgs 类型
function isValidForecastArgs(args) {
    return (typeof args === "object" &&
        args !== null &&
        "city" in args &&
        typeof args.city === "string" &&
        (args.days === undefined || typeof args.days === "number"));
}
