@echo off
rem Convierte las capas del proyecto QField en data\capas.json (para subir al repositorio).
setlocal
cd /d "%~dp0"
set "PROYECTO=%~1"
if "%PROYECTO%"=="" set /p PROYECTO=Carpeta del proyecto QField (arrastra la carpeta aqui y pulsa Enter): 
set "PROYECTO=%PROYECTO:"=%"
python --version >nul 2>&1 || (echo No se encontro Python. Instala Python 3 y vuelve a ejecutar. & pause & exit /b 1)
python -c "import shapefile, pyproj, shapely" >nul 2>&1 || pip install -r scripts\requirements.txt
python scripts\exportar_capas.py "%PROYECTO%" data
echo.
echo Listo. Sube data\capas.json a la carpeta data del repositorio de GitHub.
pause
