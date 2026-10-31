<?php
// NoFrame XAMPP / MySQL configuration
$DB_HOST = '127.0.0.1';
/* XAMPP's MariaDB runs on 3307 on this machine: the MySQL 8.0 Windows service
   (MYSQL80) already owns the default 3306, and XAMPP's own my.ini was moved to
   3307 to avoid the clash. Connecting without the port would reach MySQL 8.0,
   whose root account has a password — that is what produced
   "Access denied ... (using password: NO)". */
$DB_PORT = '3307';
$DB_NAME = 'noframe';
$DB_USER = 'root';
$DB_PASS = ''; // XAMPP's default root password is empty. Change this if yours is different.

// Google sign-in has been removed from the storefront: accounts are created
// with an email address and password only, so no OAuth client ID is needed.

function db(): PDO {
    global $DB_HOST, $DB_PORT, $DB_NAME, $DB_USER, $DB_PASS;
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(
            "mysql:host={$DB_HOST};port={$DB_PORT};dbname={$DB_NAME};charset=utf8mb4",
            $DB_USER,
            $DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]
        );
    }
    return $pdo;
}
