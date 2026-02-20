@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION

REM ============================================================
REM Deploy automatizado para GitHub + GitHub Pages (site estatico)
REM Uso:
REM   deploy.bat
REM   deploy.bat meu-usuario meu-repo
REM   deploy.bat meu-usuario meu-repo cardapio.seudominio.com.br
REM   deploy.bat meu-usuario meu-repo --provisorio
REM Variaveis opcionais:
REM   GITHUB_TOKEN   (obrigatorio para automacao completa)
REM   GITHUB_USER    (opcional; se nao passar por argumento, pede no prompt)
REM   GITHUB_REPO    (opcional; se nao passar por argumento, pede no prompt)
REM   CUSTOM_DOMAIN  (opcional; dominio proprio para GitHub Pages)
REM ============================================================

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo.
echo [1/9] Validando pre-requisitos...

where git >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Git nao encontrado no PATH.
  echo Instale o Git para Windows e tente novamente.
  exit /b 1
)

where curl >nul 2>nul
if errorlevel 1 (
  echo [ERRO] curl nao encontrado no PATH.
  echo Use Windows 10/11 atualizado ou instale curl.
  exit /b 1
)

if not exist "index.html" (
  echo [ERRO] index.html nao encontrado em "%SCRIPT_DIR%".
  exit /b 1
)
if not exist "css\styles.css" (
  echo [ERRO] css\styles.css nao encontrado em "%SCRIPT_DIR%".
  exit /b 1
)
if not exist "js\script.js" (
  echo [ERRO] js\script.js nao encontrado em "%SCRIPT_DIR%".
  exit /b 1
)

set "OWNER=%~1"
if "%OWNER%"=="" set "OWNER=%GITHUB_USER%"
if "%OWNER%"=="" (
  set "OWNER=caeg0n"
  set "OWNER_IN="
  set /p OWNER_IN=Informe o usuario/org do GitHub [caeg0n]: 
  if not "%OWNER_IN%"=="" set "OWNER=%OWNER_IN%"
)

set "REPO=%~2"
if "%REPO%"=="" set "REPO=%GITHUB_REPO%"
if "%REPO%"=="" (
  set "REPO=html-camppedidoscore-v1"
  set "REPO_IN="
  set /p REPO_IN=Informe o nome do repositorio [html-camppedidoscore-v1]: 
  if not "%REPO_IN%"=="" set "REPO=%REPO_IN%"
)

set "ARG3=%~3"
set "PROVISIONAL_DEPLOY=1"
if /I "%ARG3%"=="--provisorio" set "PROVISIONAL_DEPLOY=1"
if /I "%ARG3%"=="provisorio" set "PROVISIONAL_DEPLOY=1"
if /I "%ARG3%"=="--temporary" set "PROVISIONAL_DEPLOY=1"

set "DOMAIN=%ARG3%"
if /I "%ARG3%"=="--provisorio" set "DOMAIN="
if /I "%ARG3%"=="provisorio" set "DOMAIN="
if /I "%ARG3%"=="--temporary" set "DOMAIN="

if not "%DOMAIN%"=="" (
  set "PROVISIONAL_DEPLOY=0"
) else (
  if not "%CUSTOM_DOMAIN%"=="" (
    set "DOMAIN=%CUSTOM_DOMAIN%"
    set "PROVISIONAL_DEPLOY=0"
  )
)

set "TOKEN=%GITHUB_TOKEN%"
if "%TOKEN%"=="" (
  for /f %%I in ('gh auth token 2^>nul') do set "TOKEN=%%I"
)
if "%TOKEN%"=="" (
  set /p TOKEN=Informe seu GITHUB_TOKEN - classic com repo ou fine-grained com conteudo+pages: 
)

if "%OWNER%"=="" (
  echo [ERRO] OWNER vazio.
  exit /b 1
)
if "%REPO%"=="" (
  echo [ERRO] REPO vazio.
  exit /b 1
)
if "%TOKEN%"=="" (
  echo [ERRO] TOKEN vazio.
  exit /b 1
)

set "REMOTE_URL=https://github.com/%OWNER%/%REPO%.git"
set "API_REPO=https://api.github.com/repos/%OWNER%/%REPO%"

echo.
echo [2/9] Criando repositorio remoto se nao existir...
curl -s -o NUL -w "%%{http_code}" ^
  -H "Authorization: token %TOKEN%" ^
  -H "Accept: application/vnd.github+json" ^
  "%API_REPO%" > "%TEMP%\gh_repo_status.tmp"
set /p REPO_STATUS=<"%TEMP%\gh_repo_status.tmp"
del /q "%TEMP%\gh_repo_status.tmp" >nul 2>nul

if "%REPO_STATUS%"=="404" (
  echo Repositorio nao existe. Criando...
  curl -s -o "%TEMP%\gh_create_repo.json" -w "%%{http_code}" ^
    -X POST ^
    -H "Authorization: token %TOKEN%" ^
    -H "Accept: application/vnd.github+json" ^
    https://api.github.com/user/repos ^
    -d "{\"name\":\"%REPO%\",\"private\":false,\"auto_init\":false}" > "%TEMP%\gh_create_status.tmp"
  set /p CREATE_STATUS=<"%TEMP%\gh_create_status.tmp"
  del /q "%TEMP%\gh_create_status.tmp" >nul 2>nul
  if not "%CREATE_STATUS%"=="201" (
    echo [ERRO] Falha ao criar repositorio. HTTP %CREATE_STATUS%
    echo Resposta da API:
    type "%TEMP%\gh_create_repo.json"
    del /q "%TEMP%\gh_create_repo.json" >nul 2>nul
    exit /b 1
  )
  del /q "%TEMP%\gh_create_repo.json" >nul 2>nul
  echo Repositorio criado com sucesso.
) else (
  if "%REPO_STATUS%"=="200" (
    echo Repositorio remoto ja existe.
  ) else (
    echo [ERRO] Nao foi possivel consultar repositorio remoto. HTTP %REPO_STATUS%
    exit /b 1
  )
)

echo.
echo [3/9] Preparando repositorio local...
if not exist ".git" (
  git init >nul
  git branch -M main
)

for /f "delims=" %%A in ('git branch --show-current 2^>nul') do set "CUR_BRANCH=%%A"
if /i not "%CUR_BRANCH%"=="main" (
  git branch -M main >nul 2>nul
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REMOTE_URL%"
) else (
  git remote set-url origin "%REMOTE_URL%"
)

echo.
echo [4/9] Criando .gitignore minimo...
if not exist ".gitignore" (
  > ".gitignore" (
    echo .DS_Store
    echo Thumbs.db
    echo *.log
    echo .venv/
    echo preview-*.png
  )
)

echo.
echo [5/10] Atualizando numero de versao...
if not exist "VERSION.txt" (
  > "VERSION.txt" echo 1
) else (
  set /p BUILD_VER=<VERSION.txt
  if "!BUILD_VER!"=="" set "BUILD_VER=0"
  set /a BUILD_VER=!BUILD_VER!+1
  > "VERSION.txt" echo !BUILD_VER!
)
set /p BUILD_VER=<VERSION.txt
powershell -NoProfile -Command ^
  "$v='v!BUILD_VER!';" ^
  "$files=@('index.html');" ^
  "foreach($f in $files){ if(Test-Path $f){ $c=Get-Content $f -Raw; $c=$c -replace '(<span id=\"build-version\">)v?\\d+(</span>)', ('$1'+$v+'$2'); Set-Content $f $c -Encoding utf8 } }"
echo Versao atual: v!BUILD_VER!

echo.
echo [6/10] Gerando token criptografado do Admin (opcional)...
where node >nul 2>nul
if errorlevel 1 (
  echo Node nao encontrado. Pulando geracao do token criptografado do Admin.
) else (
  if not exist ".secrets" mkdir ".secrets" >nul 2>nul
  if exist "admin\\admin.js" (
    findstr /C:"const embeddedEncryptedToken = null" "admin\\admin.js" >nul 2>nul
    if not errorlevel 1 (
      set "DO_ENCRYPT=N"
      set /p DO_ENCRYPT=Gerar ou atualizar token criptografado do Admin? [s/N]: 
      if /I "!DO_ENCRYPT!"=="S" (
        set "TOKEN_FILE=%SCRIPT_DIR%.secrets\\github_token.txt"
        powershell -NoProfile -Command ^
          "$ErrorActionPreference='Stop';" ^
          "$tokenPath=$env:TOKEN_FILE;" ^
          "if (-not (Test-Path -LiteralPath $tokenPath)) { throw ('Arquivo nao encontrado: ' + $tokenPath) }" ^
          "$pt=(Get-Content -LiteralPath $tokenPath -Raw).Trim();" ^
          "if (-not $pt) { throw ('Token vazio em ' + $tokenPath) }" ^
          "$k=Read-Host 'Chave do Admin' -AsSecureString;" ^
          "$pk=[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($k));" ^
          "$inputText=$pt + \"`n\" + $pk;" ^
          "$blob=$inputText | & node admin\\encrypt-token.mjs --stdin;" ^
          "if (-not $blob) { throw 'Falha ao gerar blob criptografado' }" ^
          "$js=Get-Content admin\\admin.js -Raw;" ^
          "$json=$blob.Trim();" ^
          "$js=$js -replace 'const embeddedEncryptedToken = null;', ('const embeddedEncryptedToken = ' + $json + ';');" ^
          "Set-Content -Path admin\\admin.js -Value $js -Encoding utf8;" ^
          ""
        if errorlevel 1 (
          echo [AVISO] Falha ao gerar/injetar token criptografado. Continuando sem isso.
        ) else (
          echo Token criptografado do Admin gerado e injetado em admin\\admin.js
        )
      ) else (
        echo Pulando geracao do token criptografado do Admin.
      )
    ) else (
      echo Admin ja parece estar configurado ^(embeddedEncryptedToken nao esta como null^) . Pulando.
    )
  ) else (
    echo Pasta admin nao encontrada. Pulando.
  )
)

echo.
echo [7/10] Configurando dominio customizado...
if "%PROVISIONAL_DEPLOY%"=="1" (
  if exist "CNAME" (
    del /q "CNAME" >nul 2>nul
    echo CNAME removido para deploy provisório.
  ) else (
    echo Deploy provisório ativado - sem CNAME.
  )
) else if not "%DOMAIN%"=="" (
  > "CNAME" echo %DOMAIN%
  echo CNAME criado/atualizado: %DOMAIN%
) else (
  if exist "CNAME" (
    echo CNAME existente mantido: 
    set /p EXISTING_CNAME=<CNAME
    echo !EXISTING_CNAME!
  ) else (
    echo Nenhum dominio informado. Site sera publicado no github.io.
  )
)

echo.
echo [8/10] Commitando arquivos...
git add .
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Deploy cardapio web" >nul
) else (
  echo Nenhuma alteracao nova para commit.
)

echo.
echo [9/10] Enviando para GitHub (branch main)...
echo Sincronizando com origin/main (pull --rebase)...
git fetch origin >nul 2>nul
git show-ref --verify --quiet refs/remotes/origin/main
if not errorlevel 1 (
  git pull --rebase origin main
  if errorlevel 1 (
    echo [ERRO] Falha ao sincronizar com origin/main. Pode haver conflito.
    echo Resolva conflitos e rode o deploy novamente.
    exit /b 1
  )
)
git push -u origin main
if errorlevel 1 (
  echo [ERRO] Falha no push. Verifique permissao do token/repositorio.
  exit /b 1
)

echo.
echo [10/10] Ativando GitHub Pages via API...
curl -s -o "%TEMP%\gh_pages.json" -w "%%{http_code}" ^
  -X POST ^
  -H "Authorization: token %TOKEN%" ^
  -H "Accept: application/vnd.github+json" ^
  "%API_REPO%/pages" ^
  -d "{\"source\":{\"branch\":\"main\",\"path\":\"/\"}}" > "%TEMP%\gh_pages_status.tmp"
set /p PAGES_STATUS=<"%TEMP%\gh_pages_status.tmp"
del /q "%TEMP%\gh_pages_status.tmp" >nul 2>nul

if "%PAGES_STATUS%"=="201" (
  echo GitHub Pages ativado com sucesso.
) else (
  if "%PAGES_STATUS%"=="409" (
    echo GitHub Pages ja estava configurado.
  ) else (
    if "%PAGES_STATUS%"=="422" (
      echo GitHub Pages provavelmente ja ativo - ou sem permissao para alterar.
    ) else (
      echo [AVISO] Nao foi possivel ativar Pages automaticamente. HTTP %PAGES_STATUS%
      echo Resposta:
      type "%TEMP%\gh_pages.json"
    )
  )
)
del /q "%TEMP%\gh_pages.json" >nul 2>nul

echo.
echo [11/11] Publicacao concluida.
if not "%DOMAIN%"=="" (
  echo URL final apos DNS: https://%DOMAIN%/
  echo.
  echo Configure no DNS do dominio:
  echo 1^) Se usar www:
  echo    - CNAME  www  %OWNER%.github.io
  echo 2^) Para raiz/apex ^(opcional, sem www^), crie A records:
  echo    - 185.199.108.153
  echo    - 185.199.109.153
  echo    - 185.199.110.153
  echo    - 185.199.111.153
  echo.
  echo Depois, no GitHub repo ^> Settings ^> Pages:
  echo - confirme o dominio customizado
  echo - marque \"Enforce HTTPS\" quando habilitar
) else (
  echo URL esperada: https://%OWNER%.github.io/%REPO%/
)
echo Pode levar alguns minutos para ficar online.
echo.

exit /b 0
