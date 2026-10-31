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
function payhere_base_url(): string {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $scheme = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme . '://' . $host;
}

function payhere_hash(string $orderId, float $amount): string {
    $amountFormatted = number_format($amount, 2, '.', '');
    $hashedSecret = strtoupper(md5(PAYHERE_MERCHANT_SECRET));
    return strtoupper(md5(PAYHERE_MERCHANT_ID . $orderId . $amountFormatted . PAYHERE_CURRENCY . $hashedSecret));
}
