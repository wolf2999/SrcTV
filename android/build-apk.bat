@echo off
REM ============================================================
REM  一键导出 SrcTV 安卓 APK（无需打开 Android Studio）
REM  复用 F:\xui\Material3 同款环境（不下载任何 JDK/NDK/SDK）：
REM    JDK 17   : C:\Users\Administrator\AppData\Local\Java\jdk-17.0.20.1+1
REM    Android SDK : C:\Users\Administrator\AppData\Local\Android\Sdk
REM    Gradle 8.7  : f:\xui\gradle-home 中已缓存的发行版与依赖（阿里云镜像）
REM  首次运行会自动生成签名密钥；之后增量构建很快。
REM ============================================================
setlocal
set "JAVA_HOME=C:\Users\Administrator\AppData\Local\Java\jdk-17.0.20.1+1"
set "ANDROID_HOME=C:\Users\Administrator\AppData\Local\Android\Sdk"
set "GRADLE_USER_HOME=f:\xui\gradle-home"

cd /d "%~dp0"

REM —— 1. 签名密钥（仅首次） ——
if not exist "app\keystore.properties" (
    echo [生成签名密钥 release-key.jks ...]
    "%JAVA_HOME%\bin\keytool.exe" -genkeypair -v -keystore "app\release-key.jks" -alias srctv -keyalg RSA -keysize 2048 -validity 10000 -storepass srctv123 -keypass srctv123 -dname "CN=SrcTV, OU=Dev, O=SrcTV, L=Unknown, S=Unknown, C=CN"
    (
        echo storeFile=release-key.jks
        echo storePassword=srctv123
        echo keyAlias=srctv
        echo keyPassword=srctv123
    ) > "app\keystore.properties"
    echo [keystore.properties 已生成]
) else (
    echo [签名密钥已存在，跳过生成]
)

REM —— 2. 组装 release（同时产出 mobile / tv 两个 flavor） ——
echo [开始 Gradle assembleRelease ...]
call gradlew.bat assembleRelease --no-daemon
set "RC=%ERRORLEVEL%"
echo [Gradle 退出码: %RC%]

REM —— 3. 校验产物 ——
set "OK=0"
if exist "app\build\outputs\apk\mobile\release\app-mobile-release.apk" (
    echo [手机版 APK: app\build\outputs\apk\mobile\release\app-mobile-release.apk]
    set "OK=1"
) else (
    echo [未找到 app-mobile-release.apk（手机版）]
)
if exist "app\build\outputs\apk\tv\release\app-tv-release.apk" (
    echo [电视版 APK: app\build\outputs\apk\tv\release\app-tv-release.apk]
    set "OK=1"
) else (
    echo [未找到 app-tv-release.apk（电视版）]
)
if "%OK%"=="1" ( echo [DONE] ) else ( echo [FAILED] )
endlocal
pause
