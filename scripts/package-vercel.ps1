$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactDirectory = Join-Path $projectRoot 'artifacts'
[IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null
$zipPath = Join-Path $artifactDirectory 'research-pulse-vercel.zip'
# Explicit allowlist: never package local environment files, raw data or research materials.
$relativeFiles = @('package.json', 'package-lock.json', 'README.md', '.env.example', '.gitignore', '.vercelignore', 'vercel.json', 'Dockerfile', '.dockerignore', 'compose.yaml')
foreach ($directory in @('src', 'api', 'scripts', 'deploy', '.github', 'public-data')) {
    $base = Join-Path $projectRoot $directory
    foreach ($item in Get-ChildItem -LiteralPath $base -File -Recurse) {
        if ($item.Name -eq 'server.env' -or ($item.Name -like '.env*' -and $item.Name -ne '.env.example')) { continue }
        $relativeFiles += $item.FullName.Substring($projectRoot.Length + 1)
    }
}
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }
$archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($relative in $relativeFiles | Sort-Object -Unique) {
        $source = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
        if (-not $source.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Packaging source outside project.' }
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing deployment file: $relative" }
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $relative.Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
Write-Output "Created $zipPath"
Write-Output ('SHA256 ' + (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash)
