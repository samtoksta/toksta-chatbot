#!/usr/bin/env python
import sys
import json
import tiktoken

def count_tokens(text, model="text-embedding-3-small"):
    """Count the number of tokens in the text using the specified model's encoding"""
    try:
        encoding = tiktoken.encoding_for_model(model)
        tokens = encoding.encode(text)
        return len(tokens)
    except Exception as e:
        return {"error": str(e)}

def chunk_text(text, max_tokens=8191, model="text-embedding-3-small", overlap_tokens=50):
    """Split text into chunks that don't exceed max_tokens"""
    try:
        encoding = tiktoken.encoding_for_model(model)
        tokens = encoding.encode(text)
        
        chunks = []
        i = 0
        while i < len(tokens):
            # Find the token index that doesn't exceed max_tokens
            chunk_end = min(i + max_tokens, len(tokens))
            
            # Add the chunk
            chunk_tokens = tokens[i:chunk_end]
            chunk_text = encoding.decode(chunk_tokens)
            chunks.append(chunk_text)
            
            # Move to next chunk with overlap
            i = chunk_end - overlap_tokens if chunk_end < len(tokens) else chunk_end
            # Ensure we make progress even with a large overlap
            if i < 0 or i == i + max_tokens:
                i = chunk_end
        
        return chunks
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    # Read input from stdin
    input_data = json.loads(sys.stdin.read())
    
    action = input_data.get("action")
    text = input_data.get("text", "")
    model = input_data.get("model", "text-embedding-3-small")
    
    if action == "count_tokens":
        result = count_tokens(text, model)
    elif action == "chunk_text":
        max_tokens = input_data.get("max_tokens", 8191)
        overlap_tokens = input_data.get("overlap_tokens", 50)
        result = chunk_text(text, max_tokens, model, overlap_tokens)
    else:
        result = {"error": f"Unknown action: {action}"}
    
    # Write output to stdout
    sys.stdout.write(json.dumps({"result": result})) 