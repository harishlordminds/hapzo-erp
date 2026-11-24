@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 goto no_node
node -e "if (+process.versions.node.split('.')[0] < 24) process.exit(1)"
if errorlevel 1 goto no_node
set "HAPZO_LAUNCH_PORT=%HAPZO_PORT%"
if not defined HAPZO_LAUNCH_PORT set "HAPZO_LAUNCH_PORT=5173"
node -e "fetch('http://127.0.0.1:'+process.env.HAPZO_LAUNCH_PORT+'/api/health',{signal:AbortSignal.timeout(1000)}).then(r=>r.json()).then(b=>process.exit(b.service==='hapzo-local'?0:1)).catch(()=>process.exit(1))"
if not errorlevel 1 (
  start "" "http://127.0.0.1:%HAPZO_LAUNCH_PORT%/"
  exit /b 0
)
if not exist "node_modules\vite\package.json" (
  echo Installing the local software dependencies...
  call npm.cmd ci --no-audit --no-fund --ignore-scripts
  if errorlevel 1 goto fail
)
echo Keep this window open while using HAPZO. Press Ctrl+C to stop the local server.
call npm.cmd run build
if errorlevel 1 goto fail
node server.mjs --open
if errorlevel 1 goto fail
exit /b 0

:no_node
echo HAPZO requires Node.js 24 or newer to run.
:fail
echo HAPZO did not start. See the error above.
pause
exit /b 1
