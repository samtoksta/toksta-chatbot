import { spawn } from 'child_process';
import path from 'path';

interface TiktokenBridgeResult<T> {
  result: T | { error: string };
}

/**
 * Call the Python tiktoken bridge with the given input
 */
async function callTiktokenBridge<T>(input: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [path.resolve(process.cwd(), 'scripts/tiktoken_bridge.py')]);
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
        const response = JSON.parse(dataString) as TiktokenBridgeResult<T>;
        const result = response.result;
        
        if (result && typeof result === 'object' && 'error' in result) {
          return reject(new Error(`Tiktoken error: ${(result as any).error}`));
        }
        
        resolve(result as T);
      } catch (error) {
        reject(new Error(`Failed to parse Python output: ${error}`));
      }
    });

    pythonProcess.stdin.write(JSON.stringify(input));
    pythonProcess.stdin.end();
  });
}

/**
 * Count tokens in a string using tiktoken
 */
export async function countTokens(text: string, model: string = 'text-embedding-3-small'): Promise<number> {
  if (!text) return 0;
  
  try {
    return await callTiktokenBridge<number>({
      action: 'count_tokens',
      text,
      model
    });
  } catch (error) {
    console.error('Error counting tokens:', error);
    // Fallback to a character-based estimation if tiktoken fails
    return Math.ceil(text.length / 4); // Rough estimate of 4 chars per token
  }
}

/**
 * Split text into chunks that don't exceed max_tokens
 */
export async function chunkText(
  text: string, 
  maxTokens: number = 8191, 
  model: string = 'text-embedding-3-small',
  overlapTokens: number = 50
): Promise<string[]> {
  if (!text) return [];
  
  try {
    return await callTiktokenBridge<string[]>({
      action: 'chunk_text',
      text,
      model,
      max_tokens: maxTokens,
      overlap_tokens: overlapTokens
    });
  } catch (error) {
    console.error('Error chunking text:', error);
    // Return the text as a single chunk if tiktoken fails
    return [text];
  }
} 