// test-tiktoken.ts
import { get_encoding, Tiktoken } from 'tiktoken';

console.log("Attempting to load tiktoken...");

async function main() {
  try {
    const encodingName = "cl100k_base";
    console.log(`Attempting to get encoding for: ${encodingName}`);
    const tokenizer: Tiktoken = get_encoding(encodingName);
    console.log(`Tiktoken loaded successfully for encoding: ${encodingName}`);
    
    const textToEncode = "hello world";
    console.log(`Encoding text: "${textToEncode}"`);
    const tokens = tokenizer.encode(textToEncode);
    console.log("Encoded 'hello world':", tokens);
    console.log("Token count:", tokens.length);
    
    tokenizer.free(); // Important to free the tokenizer when done
    console.log("Tokenizer freed.");

  } catch (e) {
    console.error("Error loading or using tiktoken:", e);
    // Add a specific check for the common WASM issue
    if (e instanceof Error && e.message.includes("instantiate Wasm") || (e instanceof Error && e.message.includes("WebAssembly"))) {
        console.error("This error often indicates an issue with loading the WebAssembly (WASM) module for tiktoken.");
        console.error("Potential causes: ");
        console.error("  1. The tiktoken_bg.wasm file is missing or corrupted in node_modules/tiktoken.");
        console.error("  2. Your Node.js environment has restrictions loading WASM (less common for local CLI usage).");
        console.error("  3. An issue with the tiktoken installation itself (try reinstalling: npm uninstall tiktoken && npm install tiktoken).");
    }
    process.exit(1); // Exit with error code if tiktoken fails
  }
}

main();