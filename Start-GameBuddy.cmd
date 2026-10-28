@echo off
cd /d "%~dp0"
node scripts\launch-product.mjs
if errorlevel 1 pause
