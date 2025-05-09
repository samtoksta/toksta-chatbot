#!/bin/bash

# Check if npx is available
if ! command -v npx &> /dev/null; then
    echo "Error: npx is required but not found. Please install Node.js and npm."
    exit 1
fi

# Check if Python is available
if ! command -v python &> /dev/null; then
    echo "Error: Python is required but not found. Please install Python 3.x"
    exit 1
fi

# Check if tiktoken is installed
python -c "import tiktoken" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Installing tiktoken library..."
    pip install tiktoken
fi

# Run the seed script with ts-node
echo "Running data seeding process..."
npx ts-node scripts/seed.ts

# Check if it was successful
if [ $? -eq 0 ]; then
    echo "Seed process completed successfully!"
else
    echo "Seed process failed with error code $?"
    exit 1
fi 