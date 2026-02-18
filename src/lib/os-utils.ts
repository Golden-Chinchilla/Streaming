export function isMac(): boolean {
    if (typeof navigator === "undefined") return false;
    return navigator.userAgent.toLowerCase().includes("mac");
}
