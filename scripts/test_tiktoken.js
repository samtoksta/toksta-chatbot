const { spawn } = require('child_process');
const path = require('path');

// Test the tiktoken bridge
function testTiktokenBridge() {
  const pythonScript = path.resolve(process.cwd(), 'scripts/tiktoken_bridge.py');
  const testText = "This is a test string to verify that our tiktoken bridge is working correctly.";
  
  console.log("Testing tiktoken bridge...");
  
  // Test token counting
  console.log("Testing token counting...");
  callPythonScript(pythonScript, {
    action: 'count_tokens',
    text: testText,
    model: 'text-embedding-3-small'
  })
    .then(result => {
      console.log(`✅ Token count result: ${result}`);
      
      // Test text chunking
      console.log("\nTesting text chunking...");
      return callPythonScript(pythonScript, {
        action: 'chunk_text',
        text: testText.repeat(10), // Make it longer to ensure it chunks
        max_tokens: 20,
        model: 'text-embedding-3-small',
        overlap_tokens: 3
      });
    })
    .then(chunks => {
      console.log(`✅ Chunked into ${chunks.length} pieces:`);
      chunks.forEach((chunk, i) => {
        console.log(`  Chunk ${i+1}: "${chunk.substring(0, 30)}${chunk.length > 30 ? '...' : ''}"`);
      });
      console.log("\nAll tests passed! The tiktoken bridge is working correctly.");
    })
    .catch(error => {
      console.error("❌ Test failed:", error);
      process.exit(1);
    });
}

// Helper function to call the Python script
function callPythonScript(scriptPath, input) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [scriptPath]);
    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => {
      dataString += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorString += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python process exited with code ${code}: ${errorString}`));
      }

      try {
        const response = JSON.parse(dataString);
        if (response.result && response.result.error) {
          return reject(new Error(`Tiktoken error: ${response.result.error}`));
        }
        resolve(response.result);
      } catch (error) {
        reject(new Error(`Failed to parse Python output: ${error}\nRaw output: ${dataString}`));
      }
    });

    pythonProcess.stdin.write(JSON.stringify(input));
    pythonProcess.stdin.end();
  });
}

// Run the test
testTiktokenBridge(); 