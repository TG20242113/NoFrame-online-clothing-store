<?php
// PayHere server callback endpoint.
// This file is intentionally silent in the browser: PayHere posts here from its server.
// localhost cannot receive this callback. Deploy the same endpoint on a public HTTPS URL
// before relying on automatic payment-status updates.
require_once __DIR__ . '/config.php';

$merchantId = $_POST['merchant_id'] ?? '';
$orderId = $_POST['order_id'] ?? '';
$paymentId = $_POST['payment_id'] ?? '';
$amount = $_POST['payhere_amount'] ?? '';
$currency = $_POST['payhere_currency'] ?? '';
$statusCode = $_POST['status_code'] ?? '';
$md5sig = strtoupper($_POST['md5sig'] ?? '');

$localMd5 = strtoupper(md5($merchantId . $orderId . $amount . $currency . $statusCode . strtoupper(md5(PAYHERE_MERCHANT_SECRET))));

if (!$merchantId || $merchantId !== PAYHERE_MERCHANT_ID || !$md5sig || !hash_equals($localMd5, $md5sig)) {
    http_response_code(400);
    exit('INVALID');
}

// TODO: update your MySQL orders table here when the notification endpoint is public.
// PayHere status codes: 2 success, 0 pending, -1 cancelled, -2 failed, -3 chargeback.
http_response_code(200);
echo 'OK';
