@echo off
chcp 65001 >nul
echo.
echo  ============================
echo   AIGC Canvas 启动中...
echo  ============================
echo.

:: 安装后端依赖（首次运行需要）
echo [1/4] 检查后端依赖...
cd /d "%~dp0backend"
if not exist node_modules (
    echo      正在安装后端依赖，请稍候...
    call npm install
)

:: 安装前端依赖（首次运行需要）
echo [2/4] 检查前端依赖...
cd /d "%~dp0frontend"
if not exist node_modules (
    echo      正在安装前端依赖，请稍候...
    call npm install
)

:: 启动后端
echo [3/4] 启动后端服务 (端口 3001)...
cd /d "%~dp0backend"
start "AIGC-Backend" cmd /k "node index.js"

:: 等待后端启动
timeout /t 2 /nobreak >nul

:: 启动前端
echo [4/4] 启动前端服务 (端口 5173)...
cd /d "%~dp0frontend"
start "AIGC-Frontend" cmd /k "npm run dev"

:: 等待前端启动
timeout /t 3 /nobreak >nul

echo.
echo  ✅ 启动完成！请在浏览器打开：
echo     http://localhost:5173
echo.
start http://localhost:5173

pause
