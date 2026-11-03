<?php
// NoFrame + PayHere Sandbox configuration.
// IMPORTANT: keep your Merchant Secret on the server. Do not put it in JS/HTML.
// Replace these two values with the CURRENT values shown in your PayHere
// Merchant Portal -> Integrations -> localhost row.

const PAYHERE_MERCHANT_ID = '1238461';
const PAYHERE_MERCHANT_SECRET = 'MTY5MjA1MzkwODEyNzY1MzEyNDcxMjIwNDU3MTQyODkzMTcwNjM=';

const PAYHERE_ACTION = 'https://sandbox.payhere.lk/pay/checkout';
const PAYHERE_CURRENCY = 'LKR';

// These URLs are only for browser redirects. notify.php requires a public URL
// before PayHere can call it from its servers.
// Browser-facing base of the shop. It has to include the folder the project is
// served from: XAMPP normally hands out http://localhost/<project>/... so a
// bare http://localhost/payment/return.php 404s after PayHere redirects the
// shopper back, which left them stranded on Apache's error page.
function payhere_base_url(): string {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $scheme = $https ? 'https' : 'http';
    $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';

    // /my shop/payment/start.php -> /my shop ; /payment/start.php -> '' (docroot install)
    $prefix = '';
    $script = rawurldecode($_SERVER['SCRIPT_NAME'] ?? '');
    if ($script !== '') {
        $dir = str_replace('\\', '/', dirname(dirname($script)));
        if ($dir !== '' && $dir !== '.' && $dir !== '/') $prefix = $dir;
    }

    // Fallback for servers that leave SCRIPT_NAME empty: compare the project
    // folder (the parent of /payment) with the document root instead.
    if ($prefix === '' && !empty($_SERVER['DOCUMENT_ROOT'])) {
        $docRoot = rtrim(str_replace('\\', '/', rawurldecode($_SERVER['DOCUMENT_ROOT'])), '/');
        $project = rtrim(str_replace('\\', '/', dirname(__DIR__)), '/');
        if ($docRoot !== '' && strlen($project) > strlen($docRoot)
            && strncasecmp($project, $docRoot, strlen($docRoot)) === 0) {
            $prefix = substr($project, strlen($docRoot));
        }
    }

    // Percent-encode every segment so a space in the folder name survives.
    $encoded = '';
    foreach (explode('/', str_replace('\\', '/', $prefix)) as $segment) {
        if ($segment === '') continue;
        $encoded .= '/' . rawurlencode($segment);
    }

    return rtrim($scheme . '://' . $host . $encoded, '/');
}

function payhere_hash(string $orderId, float $amount): string {
    $amountFormatted = number_format($amount, 2, '.', '');
    $hashedSecret = strtoupper(md5(PAYHERE_MERCHANT_SECRET));
    return strtoupper(md5(PAYHERE_MERCHANT_ID . $orderId . $amountFormatted . PAYHERE_CURRENCY . $hashedSecret));
}
