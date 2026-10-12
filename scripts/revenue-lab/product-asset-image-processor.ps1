param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [string]$OutputPath,
  [switch]$InspectOnly,
  [int]$TargetWidth = 720,
  [int]$TargetHeight = 1280,
  [string]$Background = '#FFFFFF'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = $null
$canvas = $null
$graphics = $null
try {
  $source = [System.Drawing.Image]::FromFile($InputPath, $true)
  if ($source.Width -lt 1 -or $source.Height -lt 1) { throw 'Decoded image dimensions are invalid.' }
  if ($InspectOnly) {
    [Console]::Out.Write((@{ width = $source.Width; height = $source.Height } | ConvertTo-Json -Compress))
    return
  }
  if ([string]::IsNullOrWhiteSpace($OutputPath)) { throw 'OutputPath is required unless InspectOnly is used.' }
  $canvas = New-Object System.Drawing.Bitmap($TargetWidth, $TargetHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($Background))
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $scale = [Math]::Min($TargetWidth / $source.Width, $TargetHeight / $source.Height)
  $width = [Math]::Max(1, [Math]::Round($source.Width * $scale))
  $height = [Math]::Max(1, [Math]::Round($source.Height * $scale))
  $x = [Math]::Floor(($TargetWidth - $width) / 2)
  $y = [Math]::Floor(($TargetHeight - $height) / 2)
  $graphics.DrawImage($source, $x, $y, $width, $height)
  $canvas.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  [Console]::Out.Write((@{ width = $TargetWidth; height = $TargetHeight; contentType = 'image/png' } | ConvertTo-Json -Compress))
} finally {
  if ($graphics) { $graphics.Dispose() }
  if ($canvas) { $canvas.Dispose() }
  if ($source) { $source.Dispose() }
}
