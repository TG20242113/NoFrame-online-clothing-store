<?php
// Simple lightweight JWT implementation for PHP using HMAC SHA-256

if (!defined('JWT_SECRET')) {
    define('JWT_SECRET', 'NoFrame_Secure_JWT_Secret_Key_2026_!@#$');
}

function base64UrlEncode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64UrlDecode(string $data): string {
    return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4));
}

function jwtGenerate(array $payload, int $ttl = 86400): string {
    $header = json_encode(['alg' => 'HS256', 'typ' => 'JWT']);
    $payload['iat'] = time();
    $payload['exp'] = time() + $ttl;
    $payloadJson = json_encode($payload);

    $base64UrlHeader = base64UrlEncode($header);
    $base64UrlPayload = base64UrlEncode($payloadJson);

    $signature = hash_hmac('sha256', $base64UrlHeader . '.' . $base64UrlPayload, JWT_SECRET, true);
    $base64UrlSignature = base64UrlEncode($signature);

    return $base64UrlHeader . '.' . $base64UrlPayload . '.' . $base64UrlSignature;
}

function jwtVerify(string $jwt): ?array {
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) {
        return null;
    }

    list($base64UrlHeader, $base64UrlPayload, $base64UrlSignature) = $parts;

    $signature = base64UrlDecode($base64UrlSignature);
    $expectedSignature = hash_hmac('sha256', $base64UrlHeader . '.' . $base64UrlPayload, JWT_SECRET, true);

    if (!hash_equals($signature, $expectedSignature)) {
        return null;
    }

    $payload = json_decode(base64UrlDecode($base64UrlPayload), true);
    if (!is_array($payload)) {
        return null;
    }

    if (isset($payload['exp']) && $payload['exp'] < time()) {
        return null;
    }

    return $payload;
}
