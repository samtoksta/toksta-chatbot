@echo off

REM Check if Python is available
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: Python is required but not found. Please install Python 3.x
    exit /b 1
)

REM Check if tiktoken is installed
python -c "import tiktoken" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Installing tiktoken library...
    pip install tiktoken
)

REM Check if npx is available
where npx >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: npx is required but not found. Please install Node.js and npm.
    exit /b 1
)

REM Run the seed script with ts-node
echo Running data seeding process...
npx ts-node scripts/seed.ts

REM Check if it was successful
if %ERRORLEVEL% NEQ 0 (
    echo Seed process failed with error code %ERRORLEVEL%
    exit /b 1
) else (
    echo Seed process completed successfully!
) 