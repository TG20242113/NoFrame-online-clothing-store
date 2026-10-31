<?php
header('Content-Type: text/plain; charset=utf-8');
require_once __DIR__ . '/config.php';
try {
    $pdo = db();
    echo "NoFrame API OK\nDatabase: noframe\nMySQL connection: successful\n";
} catch (Throwable $e) {
    http_response_code(500);
    echo "Database connection failed: " . $e->getMessage();
}
