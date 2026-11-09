@echo off
rem Run by the hourly Windows task "whimsy-spike0". Safe to run by hand too.
"%~dp0.venv\Scripts\python.exe" -I "%~dp0scripts\queue.py" >> "%~dp0out\queue-console.log" 2>&1
