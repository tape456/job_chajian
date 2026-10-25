# 下载 pdf.js（pdfjs-dist）固定版本到 lib/vendor，供插件本地解析 PDF。
# 用法：powershell -ExecutionPolicy Bypass -File scripts/fetch-pdfjs.ps1
$ErrorActionPreference = 'Stop'

$Version = '3.11.174'
$Root = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $Root 'lib\vendor'
$Files = @('pdf.min.js', 'pdf.worker.min.js')

if (-not (Test-Path -LiteralPath $Dest)) {
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
}

$Bases = @(
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@$Version/build",
    "https://unpkg.com/pdfjs-dist@$Version/build",
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/$Version"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

foreach ($f in $Files) {
    $target = Join-Path $Dest $f
    if (Test-Path -LiteralPath $target) {
        Write-Host "已存在，跳过: $f"
        continue
    }
    $ok = $false
    foreach ($b in $Bases) {
        $url = "$b/$f"
        try {
            Write-Host "下载 $url ..."
            Invoke-WebRequest -Uri $url -OutFile $target -TimeoutSec 60 -UseBasicParsing
            if ((Get-Item -LiteralPath $target).Length -gt 10000) { $ok = $true; break }
        } catch {
            Write-Host "  失败: $($_.Exception.Message)"
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
        }
    }
    if (-not $ok) {
        Write-Error "下载 $f 失败，请按 lib/vendor/README.md 手动下载。"
        exit 1
    }
}

Write-Host "pdf.js $Version 已就绪于 $Dest"
