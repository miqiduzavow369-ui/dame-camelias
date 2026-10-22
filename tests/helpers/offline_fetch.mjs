// Test preloader: unmocked fetch must never leave the test process.
globalThis.fetch=async()=>{throw Error("External network disabled in regression tests");};
