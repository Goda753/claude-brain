[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
[System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]20)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$streamW = 1280
while ($true) {
    try {
        $s   = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $src = New-Object System.Drawing.Bitmap($s.Width, $s.Height)
        $g0  = [System.Drawing.Graphics]::FromImage($src)
        $g0.CopyFromScreen($s.X, $s.Y, 0, 0, $src.Size)
        $g0.Dispose()
        $streamH = [int]($s.Height * $streamW / $s.Width)
        $bm = New-Object System.Drawing.Bitmap($streamW, $streamH)
        $g  = [System.Drawing.Graphics]::FromImage($bm)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Low
        $g.DrawImage($src, 0, 0, $streamW, $streamH)
        $g.Dispose(); $src.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $bm.Save($ms, $codec, $ep)
        $bm.Dispose()
        $b64 = [Convert]::ToBase64String($ms.ToArray())
        $ms.Dispose()
        Write-Output "FRAME:$($streamW),$($streamH):$b64"
    } catch {
        Write-Output "ERROR:$($_.Exception.Message)"
        Start-Sleep -Milliseconds 1000
    }
    Start-Sleep -Milliseconds 67
}