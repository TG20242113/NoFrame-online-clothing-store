<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/jwt.php';

function out($payload, $status=200) {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function arr($value) {
    if ($value === null || $value === '') return [];
    $x = json_decode($value, true);
    return is_array($x) ? $x : [];
}

function bodyJson() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (!is_array($data)) out(['ok'=>false,'message'=>'Invalid JSON body'], 400);
    return $data;
}

function getAuthToken(): ?string {
    if (!empty($_COOKIE['token'])) {
        return $_COOKIE['token'];
    }
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
        return $matches[1];
    }
    return null;
}

function getAuthenticatedUser(PDO $pdo): ?array {
    $token = getAuthToken();
    if (!$token) return null;
    $payload = jwtVerify($token);
    if (!$payload || empty($payload['sub'])) return null;

    $stmt = $pdo->prepare("SELECT u.id, u.name, u.email, u.role, u.created_at, u.password_hash,
                           p.phone, p.shipping_address, p.billing_address, p.avatar, p.account_status
                           FROM users u
                           LEFT JOIN user_profiles p ON u.id = p.user_id
                           WHERE u.id = ?");
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();
    return $user ?: null;
}

/* --- SERVER-SIDE RBAC GUARDS (Week 08: hiding a link is not protection) --- */
function requireAuth(PDO $pdo): array {
    $user = getAuthenticatedUser($pdo);
    if (!$user) {
        out(['ok'=>false, 'success'=>false, 'message'=>'Unauthorized session'], 401);
    }
    return $user;
}

function requireAdmin(PDO $pdo): array {
    $user = requireAuth($pdo);
    if (($user['role'] ?? 'customer') !== 'admin') {
        out(['ok'=>false, 'success'=>false, 'message'=>'Access denied — administrator account required'], 403);
    }
    return $user;
}

function hasColumn(PDO $pdo, string $table, string $column): bool {
    static $cache = [];
    $key = $table . '.' . $column;
    if (!array_key_exists($key, $cache)) {
        $stmt = $pdo->prepare("SHOW COLUMNS FROM `{$table}` LIKE ?");
        $stmt->execute([$column]);
        $cache[$key] = (bool)$stmt->fetchColumn();
    }
    return $cache[$key];
}

/* --- PRODUCT QUESTIONS (Q&A) -------------------------------------------
   One small table, created on demand so an existing XAMPP install picks the
   feature up without a manual migration. */
function ensureQuestionsTable(PDO $pdo): void {
    static $done = false;
    if ($done) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS product_questions (
        id VARCHAR(64) PRIMARY KEY,
        product_id VARCHAR(80) NOT NULL,
        user_id VARCHAR(50),
        user_name VARCHAR(150) NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NULL,
        answered_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        KEY idx_pq_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $done = true;
}

function questionsOut(PDO $pdo): array {
    ensureQuestionsTable($pdo);
    $rows = [];
    foreach ($pdo->query("SELECT id, product_id, user_id, user_name, question, answer, answered_at, created_at FROM product_questions ORDER BY created_at DESC") as $r) {
        $rows[] = ['id'=>$r['id'], 'productId'=>$r['product_id'], 'userId'=>$r['user_id'],
                   'userName'=>$r['user_name'], 'question'=>$r['question'],
                   'answer'=>$r['answer'], 'answeredAt'=>$r['answered_at'] ? (int)$r['answered_at'] : null,
                   'createdAt'=>(int)$r['created_at']];
    }
    return $rows;
}

/* --- ORDER RETURNS ----------------------------------------------------
   A customer who bought something can ask for a return from their own order
   history. The request (status, reason, note, timestamps) rides in an optional
   TEXT column that is added on demand, so an existing XAMPP install picks the
   feature up without a manual migration — the same pattern as discount_pin
   and product_questions. */
function returnColumnReady(PDO $pdo): bool {
    static $ready = null;
    if ($ready !== null) return $ready;
    if (hasColumn($pdo, 'orders', 'return_request')) { $ready = true; return $ready; }
    try {
        $pdo->exec("ALTER TABLE orders ADD COLUMN return_request TEXT NULL AFTER status");
        $ready = true;
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

function returnOut($value): ?array {
    if ($value === null || $value === '') return null;
    $x = json_decode($value, true);
    return is_array($x) ? $x : null;
}

function paymentColumnReady(PDO $pdo): bool {
    /* How the order was paid (method, card, transaction id, paid-at). Stored in
       the same on-demand way as return_request: without it every order reads
       back as "PayHere" and cash-on-delivery orders lose their real state. */
    if (hasColumn($pdo, 'orders', 'payment')) return true;
    try {
        $pdo->exec("ALTER TABLE orders ADD COLUMN payment TEXT NULL");
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

function orderOut(array $r, bool $withReturn, bool $withPay=false): array {
    return ['id'=>$r['id'], 'userId'=>$r['user_id'], 'items'=>arr($r['items']),
        'subtotal'=>(float)$r['subtotal'], 'delivery'=>(float)$r['delivery'], 'total'=>(float)$r['total'],
        'status'=>$r['status'], 'shipping'=>arr($r['shipping']), 'createdAt'=>(int)$r['created_at'],
        'payment'=>$withPay && !empty($r['payment']) ? arr($r['payment']) : null,
        'returnRequest'=>$withReturn ? returnOut($r['return_request'] ?? null) : null];
}

function validatePasswordComplexity(string $pw): array {
    if (strlen($pw) < 8) {
        return ['valid' => false, 'message' => 'Password must be at least 8 characters long.'];
    }
    if (!preg_match('/[A-Z]/', $pw)) {
        return ['valid' => false, 'message' => 'Password must contain at least one uppercase letter.'];
    }
    if (!preg_match('/[a-z]/', $pw)) {
        return ['valid' => false, 'message' => 'Password must contain at least one lowercase letter.'];
    }
    if (!preg_match('/[0-9]/', $pw)) {
        return ['valid' => false, 'message' => 'Password must contain at least one number.'];
    }
    if (!preg_match('/[@$!%*?&#^()_+\-=\[\]{};\':"\\\\|,.<>\/?]/', $pw)) {
        return ['valid' => false, 'message' => 'Password must contain at least one special character.'];
    }
    return ['valid' => true, 'message' => 'Password meets complexity requirements.'];
}

try {
    $pdo = db();
    $action = $_GET['action'] ?? 'load';

    /* --- AUTHENTICATION ENDPOINTS --- */

    if ($action === 'register') {
        $data = bodyJson();
        $name = trim($data['name'] ?? $data['full_name'] ?? '');
        $email = trim(strtolower($data['email'] ?? ''));
        $password = $data['password'] ?? '';
        $confirmPassword = $data['confirm_password'] ?? $data['confirmPassword'] ?? '';
        $phone = trim($data['phone'] ?? '');

        if (!$name || !$email || !$password) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Please fill in all required fields (Name, Email, Password)'], 400);
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Invalid email address format'], 400);
        }

        $pwCheck = validatePasswordComplexity($password);
        if (!$pwCheck['valid']) {
            out(['ok'=>false, 'success'=>false, 'message'=>$pwCheck['message']], 400);
        }

        if ($password !== $confirmPassword) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Password and confirm password do not match'], 400);
        }

        // Check if user exists (Step 1)
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetchColumn() > 0) {
            out(['ok'=>false, 'success'=>false, 'message'=>'An account with this email address already exists'], 400);
        }

        // Hash password with bcrypt (Step 2)
        $hashedPw = password_hash($password, PASSWORD_BCRYPT);
        $userId = 'U' . uniqid();
        // Self-registration ALWAYS lands as role "customer" (admins are seeded
        // directly in the database) and may carry a first-order discount PIN.
        $discountPin = trim($data['discount_pin'] ?? '');

        // Insert into Users & Profiles (Step 3)
        $pdo->beginTransaction();
        if ($discountPin !== '' && hasColumn($pdo, 'users', 'discount_pin')) {
            $stmt = $pdo->prepare("INSERT INTO users(id, name, email, password_hash, role, discount_pin) VALUES(?, ?, ?, ?, ?, ?)");
            $stmt->execute([$userId, $name, $email, $hashedPw, 'customer', $discountPin]);
        } else {
            $stmt = $pdo->prepare("INSERT INTO users(id, name, email, password_hash, role) VALUES(?, ?, ?, ?, ?)");
            $stmt->execute([$userId, $name, $email, $hashedPw, 'customer']);
        }

        $stmt = $pdo->prepare("INSERT INTO user_profiles(user_id, phone, shipping_address, billing_address, avatar, account_status) VALUES(?, ?, ?, ?, ?, ?)");
        $stmt->execute([$userId, $phone, '', '', '/assets/u1.svg', 'Active Member']);
        $pdo->commit();

        out(['ok'=>true, 'success'=>true, 'message'=>'User registered successfully', 'userId'=>$userId], 201);
    }

    if ($action === 'login') {
        $data = bodyJson();
        $email = trim(strtolower($data['email'] ?? ''));
        $password = $data['password'] ?? '';

        if (!$email || !$password) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Invalid email or password'], 400);
        }

        $stmt = $pdo->prepare("SELECT u.id, u.name, u.email, u.role, u.created_at, u.password_hash,
                               p.phone, p.shipping_address, p.billing_address, p.avatar, p.account_status" .
                               (hasColumn($pdo, 'users', 'discount_pin') ? ", u.discount_pin" : "") .
                               " FROM users u
                               LEFT JOIN user_profiles p ON u.id = p.user_id
                               WHERE u.email = ?");
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        // SECURITY IMPERATIVE: Prevent user enumeration by returning a generic error message
        if (!$user || !password_verify($password, $user['password_hash'])) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Invalid email or password'], 401);
        }

        $jwtPayload = [
            'sub' => $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'avatar' => $user['avatar'] ?: '/assets/u1.svg',
            'role' => $user['role'] === 'admin' ? 'admin' : 'authenticated'
        ];
        $token = jwtGenerate($jwtPayload, 86400);

        setcookie('token', $token, [
            'expires' => time() + 86400,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax'
        ]);

        unset($user['password_hash']);

        out([
            'ok' => true,
            'success' => true,
            'message' => 'Logged in successfully',
            'token' => $token,
            'user' => [
                'id' => $user['id'],
                'name' => $user['name'],
                'email' => $user['email'],
                'role' => $user['role'],
                'phone' => $user['phone'] ?? '',
                'address' => $user['shipping_address'] ?? '',
                'shippingAddress' => $user['shipping_address'] ?? '',
                'billingAddress' => $user['billing_address'] ?? '',
                'avatar' => $user['avatar'] ?? '/assets/u1.svg',
                'accountStatus' => $user['account_status'] ?? 'Active Member',
                'createdAt' => $user['created_at'],
                'discountPin' => $user['discount_pin'] ?? null
            ]
        ]);
    }

    if ($action === 'logout') {
        setcookie('token', '', [
            'expires' => time() - 3600,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
        out(['ok'=>true, 'success'=>true, 'message'=>'Logged out successfully']);
    }

    if ($action === 'profile') {
        $authUser = getAuthenticatedUser($pdo);
        if (!$authUser) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Unauthorized session'], 401);
        }

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $data = bodyJson();
            $name = trim($data['name'] ?? $authUser['name']);
            $phone = trim($data['phone'] ?? $authUser['phone']);
            $shippingAddress = trim($data['shipping_address'] ?? $data['shippingAddress'] ?? $authUser['shipping_address']);
            $billingAddress = trim($data['billing_address'] ?? $data['billingAddress'] ?? $authUser['billing_address']);
            $avatar = trim($data['avatar'] ?? $authUser['avatar']);

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("UPDATE users SET name = ? WHERE id = ?");
            $stmt->execute([$name, $authUser['id']]);

            $stmt = $pdo->prepare("INSERT INTO user_profiles (user_id, phone, shipping_address, billing_address, avatar, account_status)
                                   VALUES (?, ?, ?, ?, ?, 'Active Member')
                                   ON DUPLICATE KEY UPDATE phone = ?, shipping_address = ?, billing_address = ?, avatar = ?");
            $stmt->execute([$authUser['id'], $phone, $shippingAddress, $billingAddress, $avatar, $phone, $shippingAddress, $billingAddress, $avatar]);
            $pdo->commit();

            $authUser['name'] = $name;
            $authUser['phone'] = $phone;
            $authUser['shipping_address'] = $shippingAddress;
            $authUser['billing_address'] = $billingAddress;
            $authUser['avatar'] = $avatar;
        }

        unset($authUser['password_hash']);
        out([
            'ok' => true,
            'success' => true,
            'user' => [
                'id' => $authUser['id'],
                'name' => $authUser['name'],
                'email' => $authUser['email'],
                'role' => $authUser['role'],
                'phone' => $authUser['phone'] ?? '',
                'address' => $authUser['shipping_address'] ?? '',
                'shippingAddress' => $authUser['shipping_address'] ?? '',
                'billingAddress' => $authUser['billing_address'] ?? '',
                'avatar' => $authUser['avatar'] ?? '/assets/u1.svg',
                'accountStatus' => $authUser['account_status'] ?? 'Active Member',
                'createdAt' => $authUser['created_at']
            ]
        ]);
    }

    /* --- OPTIONAL PROFILE PHOTO ---
       The browser resizes the picture and posts it as a base64 image; we save
       it as a file under assets/avatars/ (the DB column only holds the short
       URL) and store that URL on the caller's own profile row. */
    if ($action === 'upload_avatar') {
        $authUser = requireAuth($pdo);
        $data = bodyJson();
        $dataUrl = trim($data['dataUrl'] ?? '');

        if (!preg_match('#^data:image/(jpeg|jpg|png|webp);base64,#i', $dataUrl)) {
            out(['ok'=>false,'message'=>'Send the photo as a base64 image data URL'], 400);
        }
        $comma = strpos($dataUrl, ',');
        $bin = base64_decode(substr($dataUrl, $comma + 1), true);
        if ($bin === false || strlen($bin) < 100) {
            out(['ok'=>false,'message'=>'That photo could not be read'], 400);
        }
        if (strlen($bin) > 300000) {
            out(['ok'=>false,'message'=>'Photo is too large — maximum 300 KB'], 413);
        }

        $dir = dirname(__DIR__) . '/assets/avatars';
        if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
            out(['ok'=>false,'message'=>'Could not create assets/avatars — check folder permissions'], 500);
        }
        $safeId = preg_replace('/[^A-Za-z0-9_-]/', '', (string)$authUser['id']);
        $name = 'avatar-' . ($safeId !== '' ? $safeId : 'user') . '-' . time() . '.jpg';
        if (@file_put_contents($dir . '/' . $name, $bin) === false) {
            out(['ok'=>false,'message'=>'Could not save the photo — check folder permissions'], 500);
        }
        $url = '../assets/avatars/' . $name;

        $stmt = $pdo->prepare("UPDATE user_profiles SET avatar = ? WHERE user_id = ?");
        $stmt->execute([$url, $authUser['id']]);
        if ($stmt->rowCount() === 0) {
            $stmt = $pdo->prepare("INSERT INTO user_profiles(user_id, phone, shipping_address, billing_address, avatar, account_status)
                                   VALUES (?, ?, '', '', ?, 'Active Member')
                                   ON DUPLICATE KEY UPDATE avatar = VALUES(avatar)");
            $stmt->execute([$authUser['id'], $authUser['phone'] ?? '', $url]);
        }

        out(['ok'=>true, 'url'=>$url]);
    }

    if ($action === 'change_password' || $action === 'change-password') {
        $authUser = getAuthenticatedUser($pdo);
        if (!$authUser) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Unauthorized session'], 401);
        }

        $data = bodyJson();
        $currentPassword = $data['current_password'] ?? '';
        $newPassword = $data['new_password'] ?? '';
        $confirmPassword = $data['confirm_new_password'] ?? $data['confirm_password'] ?? '';

        if (!password_verify($currentPassword, $authUser['password_hash'])) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Current password is incorrect'], 400);
        }

        $pwCheck = validatePasswordComplexity($newPassword);
        if (!$pwCheck['valid']) {
            out(['ok'=>false, 'success'=>false, 'message'=>$pwCheck['message']], 400);
        }

        if ($newPassword !== $confirmPassword) {
            out(['ok'=>false, 'success'=>false, 'message'=>'New password and confirmation do not match'], 400);
        }

        $newHash = password_hash($newPassword, PASSWORD_BCRYPT);
        $stmt = $pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
        $stmt->execute([$newHash, $authUser['id']]);

        out(['ok'=>true, 'success'=>true, 'message'=>'Password changed successfully']);
    }

    /* --- STORE DATA MANAGEMENT ENDPOINTS --- */

    if ($action === 'load') {
        /* DATA SEPARATION: the catalog is public, but the customer directory
           and the full order book are admin-only. A signed-in customer only
           ever receives their own orders; a guest receives none. */
        $authUser = getAuthenticatedUser($pdo);
        $isAdmin = $authUser && ($authUser['role'] ?? '') === 'admin';

        $cats = [];
        foreach ($pdo->query("SELECT id,name,cover_image FROM categories ORDER BY created_at,id") as $r) {
            $cats[] = ['id'=>$r['id'],'name'=>$r['name'],'coverImage'=>$r['cover_image']];
        }

        $products = [];
        $stmt = $pdo->query("SELECT * FROM products ORDER BY created_at,id");
        foreach ($stmt as $r) {
            $products[] = [
                'id'=>$r['id'],'title'=>$r['title'],'category'=>$r['category_id'],
                'categoryName'=>$r['category_name'],'price'=>(float)$r['price'],
                'discountPrice'=>$r['discount_price']===null?null:(float)$r['discount_price'],
                'stock'=>(int)$r['stock'],'colors'=>arr($r['colors']),'sizes'=>arr($r['sizes']),
                'images'=>arr($r['images']),'rating'=>(string)$r['rating'],
                'reviewsCount'=>(int)$r['reviews_count'],'tags'=>arr($r['tags']),
                'description'=>$r['description'],'priceUpdatedAt'=>$r['price_updated_at']
            ];
        }

        $users = [];
        $orders = [];
        if ($isAdmin) {
            /* Admin dashboard view: every account (password hashes stripped) and
               the complete order book. */
            $includePin = hasColumn($pdo, 'users', 'discount_pin');
            $queryUsers = $pdo->query("SELECT u.id, u.name, u.email, u.role, u.promo, u.created_at,
                                        p.phone, p.shipping_address, p.billing_address, p.avatar, p.account_status" .
                                        ($includePin ? ", u.discount_pin" : "") .
                                        " FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id ORDER BY u.created_at, u.id");
            foreach ($queryUsers as $r) {
                $users[] = [
                    'id'=>$r['id'], 'name'=>$r['name'], 'email'=>$r['email'],
                    'phone'=>$r['phone']??'', 'address'=>$r['shipping_address']??'',
                    'shippingAddress'=>$r['shipping_address']??'', 'billingAddress'=>$r['billing_address']??'',
                    'avatar'=>$r['avatar']??'/assets/u1.svg', 'accountStatus'=>$r['account_status']??'Active Member',
                    'role'=>$r['role'], 'promo'=>(bool)$r['promo'], 'createdAt'=>$r['created_at'],
                    'discountPin'=>$r['discount_pin'] ?? null
                ];
            }

            $withReturn = returnColumnReady($pdo);
            $withPay = paymentColumnReady($pdo);
            $sel = "SELECT id,user_id,items,subtotal,delivery,total,status,shipping,created_at"
                 . ($withReturn ? ",return_request" : "") . ($withPay ? ",payment" : "")
                 . " FROM orders ORDER BY created_at DESC";
            foreach ($pdo->query($sel) as $r) { $orders[] = orderOut($r, $withReturn, $withPay); }
        } elseif ($authUser) {
            /* Customer view: ONLY this account's own order history. */
            $withReturn = returnColumnReady($pdo);
            $withPay = paymentColumnReady($pdo);
            $stmt = $pdo->prepare("SELECT id,user_id,items,subtotal,delivery,total,status,shipping,created_at"
                . ($withReturn ? ",return_request" : "") . ($withPay ? ",payment" : "")
                . " FROM orders WHERE user_id = ? ORDER BY created_at DESC");
            $stmt->execute([$authUser['id']]);
            foreach ($stmt as $r) { $orders[] = orderOut($r, $withReturn, $withPay); }
        }

        $reviews = [];
        foreach ($pdo->query("SELECT id,product_id,user_id,user_name,rating,comment,approved,created_at FROM reviews ORDER BY created_at DESC") as $r) {
            $reviews[] = ['id'=>(string)$r['id'],'productId'=>$r['product_id'],'userId'=>$r['user_id'],
                'userName'=>$r['user_name'],'rating'=>(int)$r['rating'],'comment'=>$r['comment'],
                'approved'=>(bool)$r['approved'],'createdAt'=>(int)$r['created_at']];
        }

        $questions = [];
        try { $questions = questionsOut($pdo); } catch (Throwable $e) { /* table/permission not ready */ }

        out(['ok'=>true,'data'=>['categories'=>$cats,'products'=>$products,'orders'=>$orders,'reviews'=>$reviews,'users'=>$users,'questions'=>$questions]]);
    }

    if ($action === 'prices') {
        $prices = [];
        foreach ($pdo->query("SELECT id,price,discount_price,price_updated_at FROM products") as $r) {
            $prices[] = ['id'=>$r['id'],'price'=>(float)$r['price'],
                'discountPrice'=>$r['discount_price']===null?null:(float)$r['discount_price'],
                'updatedAt'=>$r['price_updated_at']];
        }
        out(['ok'=>true,'prices'=>$prices]);
    }

    if ($action === 'save') {
        /* SERVER-SIDE PROTECTION: only an administrator may rewrite the store
           (catalog, inventory, users, orders). Customers get a 403. */
        requireAdmin($pdo);
        /* Schema check first: ALTER TABLE would otherwise implicitly commit the
           transaction that the rewrite below opens. */
        $withReturn = returnColumnReady($pdo);
        $withPay = paymentColumnReady($pdo);
        /* Q&A is read back by /load, so it has to be written here too — without
           this every question (example or real) disappeared on the next load. */
        $withQuestions = false;
        try { ensureQuestionsTable($pdo); $withQuestions = true; }
        catch (Throwable $e) { /* questions table unavailable in this install */ }

        $data = bodyJson();
        foreach (['categories','products','users','orders','reviews','questions'] as $key) {
            if (!isset($data[$key]) || !is_array($data[$key])) $data[$key] = [];
        }

        $pdo->beginTransaction();
        $pdo->exec("DELETE FROM order_items");
        $pdo->exec("DELETE FROM orders");
        $pdo->exec("DELETE FROM reviews");
        $pdo->exec("DELETE FROM products");
        $pdo->exec("DELETE FROM categories");
        /* users / user_profiles are deliberately NOT deleted: accounts are
           upserted below so bcrypt password hashes and admin seeds survive. */

        $includePin = hasColumn($pdo, 'users', 'discount_pin');
        $userSql = $includePin
            ? "INSERT INTO users(id,name,email,password_hash,role,promo,discount_pin) VALUES(?,?,?,?,?,?,?)
               ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), role=VALUES(role), promo=VALUES(promo), discount_pin=VALUES(discount_pin)"
            : "INSERT INTO users(id,name,email,password_hash,role,promo) VALUES(?,?,?,?,?,?)
               ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), role=VALUES(role), promo=VALUES(promo)";
        $qUser = $pdo->prepare($userSql);
        $qProf = $pdo->prepare("INSERT INTO user_profiles(user_id,phone,shipping_address,billing_address,avatar,account_status) VALUES(?,?,?,?,?,?)
                                ON DUPLICATE KEY UPDATE phone=VALUES(phone), shipping_address=VALUES(shipping_address),
                                billing_address=VALUES(billing_address), avatar=VALUES(avatar), account_status=VALUES(account_status)");
        foreach ($data['users'] as $u) {
            $userId = $u['id'] ?? ('U'.uniqid());
            // Keep an existing hash unless the caller supplies one; a brand-new
            // row with no credentials gets an unusable random hash (reset only).
            if (!empty($u['passwordHash'])) {
                $hash = $u['passwordHash'];
            } elseif (!empty($u['password'])) {
                $hash = password_hash($u['password'], PASSWORD_BCRYPT);
            } else {
                $hash = password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT);
            }
            $args = [$userId, $u['name']??'', $u['email']??'', $hash, $u['role']??'customer', !empty($u['promo'])?1:0];
            if ($includePin) $args[] = $u['discountPin'] ?? null;
            $qUser->execute($args);
            $qProf->execute([$userId, $u['phone']??'', $u['shippingAddress']??$u['address']??'', $u['billingAddress']??$u['address']??'', $u['avatar']??'/assets/u1.svg', $u['accountStatus']??'Active Member']);
        }

        $q = $pdo->prepare("INSERT INTO categories(id,name,cover_image) VALUES(?,?,?)");
        foreach ($data['categories'] as $c) $q->execute([$c['id'],$c['name'],$c['coverImage']??null]);

        $q = $pdo->prepare("INSERT INTO products(id,title,category_id,category_name,price,discount_price,stock,colors,sizes,images,rating,reviews_count,tags,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        foreach ($data['products'] as $p) {
            $q->execute([$p['id'],$p['title'],$p['category'],$p['categoryName']??'',
                $p['price']??0,$p['discountPrice']??null,$p['stock']??0,
                json_encode($p['colors']??[],JSON_UNESCAPED_UNICODE),json_encode($p['sizes']??[],JSON_UNESCAPED_UNICODE),
                json_encode($p['images']??[],JSON_UNESCAPED_UNICODE),$p['rating']??4.5,$p['reviewsCount']??0,
                json_encode($p['tags']??[],JSON_UNESCAPED_UNICODE),$p['description']??'']);
        }

        $retCols = $withReturn ? ",return_request" : "";
        $retVals = $withReturn ? ",?" : "";
        $payCols = $withPay ? ",payment" : "";
        $payVals = $withPay ? ",?" : "";
        $q = $pdo->prepare("INSERT INTO orders(id,user_id,items,subtotal,delivery,total,status,shipping,created_at{$retCols}{$payCols}) VALUES(?,?,?,?,?,?,?,?,?{$retVals}{$payVals})");
        foreach ($data['orders'] as $o) {
            $args = [$o['id'],$o['userId']??null,json_encode($o['items']??[],JSON_UNESCAPED_UNICODE),
                $o['subtotal']??0,$o['delivery']??0,$o['total']??0,$o['status']??'Pending',
                json_encode($o['shipping']??[],JSON_UNESCAPED_UNICODE),$o['createdAt']??round(microtime(true)*1000)];
            if ($withReturn) {
                $rr = isset($o['returnRequest']) && is_array($o['returnRequest']) ? $o['returnRequest'] : null;
                $args[] = $rr === null ? null : json_encode($rr, JSON_UNESCAPED_UNICODE);
            }
            if ($withPay) {
                $pay = isset($o['payment']) && is_array($o['payment']) && $o['payment'] ? $o['payment'] : null;
                $args[] = $pay === null ? null : json_encode($pay, JSON_UNESCAPED_UNICODE);
            }
            $q->execute($args);
        }

        $q = $pdo->prepare("INSERT INTO reviews(product_id,user_id,user_name,rating,comment,approved,created_at) VALUES(?,?,?,?,?,?,?)");
        foreach ($data['reviews'] as $r) {
            $q->execute([$r['productId'],$r['userId']??null,$r['userName']??'',$r['rating']??5,
                $r['comment']??'',isset($r['approved'])&&$r['approved']===false?0:1,$r['createdAt']??round(microtime(true)*1000)]);
        }

        if ($withQuestions) {
            $pdo->exec("DELETE FROM product_questions");
            $q = $pdo->prepare("INSERT INTO product_questions(id,product_id,user_id,user_name,question,answer,answered_at,created_at) VALUES(?,?,?,?,?,?,?,?)");
            foreach ($data['questions'] as $x) {
                if (empty($x['id']) || empty($x['productId'])) continue;
                $q->execute([$x['id'], $x['productId'], $x['userId'] ?? null, $x['userName'] ?? '',
                    (string)($x['question'] ?? ''),
                    isset($x['answer']) && $x['answer'] !== '' && $x['answer'] !== null ? (string)$x['answer'] : null,
                    !empty($x['answeredAt']) ? (int)$x['answeredAt'] : null,
                    (int)($x['createdAt'] ?? round(microtime(true) * 1000))]);
            }
        }

        $pdo->commit();
        out(['ok'=>true,'message'=>'Database saved']);
    }

    /* --- PRODUCT Q&A: a shopper asks on the product page, the admin answers
       from the new Questions tab. Only signed-in customers may ask. --- */
    if ($action === 'ask_question') {
        $authUser = requireAuth($pdo);
        $data = bodyJson();
        $productId = trim($data['productId'] ?? '');
        $question  = trim($data['question'] ?? '');

        if ($productId === '' || $question === '') {
            out(['ok'=>false,'message'=>'Please type your question'], 400);
        }
        if (mb_strlen($question) > 600) {
            out(['ok'=>false,'message'=>'Please keep the question under 600 characters'], 400);
        }

        try { ensureQuestionsTable($pdo); }
        catch (Throwable $e) { out(['ok'=>false,'message'=>'Questions table could not be created: '.$e->getMessage()], 500); }

        $qid = 'Q' . uniqid();
        $stmt = $pdo->prepare("INSERT INTO product_questions(id, product_id, user_id, user_name, question, created_at) VALUES(?,?,?,?,?,?)");
        $stmt->execute([$qid, $productId, $authUser['id'], $authUser['name'], $question, (int)round(microtime(true)*1000)]);

        out(['ok'=>true, 'question'=>['id'=>$qid, 'productId'=>$productId, 'userId'=>$authUser['id'],
            'userName'=>$authUser['name'], 'question'=>$question, 'answer'=>null, 'answeredAt'=>null,
            'createdAt'=>(int)round(microtime(true)*1000)]]);
    }

    if ($action === 'answer_question') {
        requireAdmin($pdo);
        $data = bodyJson();
        $id = trim($data['id'] ?? '');
        $answer = trim($data['answer'] ?? '');
        if ($id === '') out(['ok'=>false,'message'=>'Question id is required'], 400);

        try { ensureQuestionsTable($pdo); }
        catch (Throwable $e) { out(['ok'=>false,'message'=>'Questions table could not be created: '.$e->getMessage()], 500); }

        if ($answer === '') {
            $stmt = $pdo->prepare("UPDATE product_questions SET answer = NULL, answered_at = NULL WHERE id = ?");
            $stmt->execute([$id]);
        } else {
            $stmt = $pdo->prepare("UPDATE product_questions SET answer = ?, answered_at = ? WHERE id = ?");
            $stmt->execute([$answer, (int)round(microtime(true)*1000), $id]);
        }
        if ($stmt->rowCount() === 0) {
            $check = $pdo->prepare("SELECT COUNT(*) FROM product_questions WHERE id = ?");
            $check->execute([$id]);
            if (!$check->fetchColumn()) out(['ok'=>false,'message'=>'That question no longer exists'], 404);
        }
        out(['ok'=>true]);
    }

    /* --- CODE-PART SYNC: write the catalogue the admin just edited back into
       data/catalog.js, so the file on disk always matches what the admin panel
       holds. Admin-only, and the previous file is kept as a .bak. --- */
    if ($action === 'export_catalog') {
        requireAdmin($pdo);
        $data = bodyJson();
        $cats = is_array($data['categories'] ?? null) ? $data['categories'] : [];
        $prods = is_array($data['products'] ?? null) ? $data['products'] : [];
        if (!$prods) {
            out(['ok'=>false,'message'=>'There are no products to export'], 400);
        }

        $catRows = [];
        $known = [];
        foreach ($cats as $c) {
            $id = (string)($c['id'] ?? '');
            if ($id === '') continue;
            $known[$id] = true;
            $catRows[] = ['id'=>$id, 'name'=>(string)($c['name'] ?? ''),
                          'coverImage'=>isset($c['coverImage']) && $c['coverImage'] !== '' ? (string)$c['coverImage'] : null];
        }

        $byCat = [];
        $kept = 0;
        foreach ($prods as $p) {
            $catId = (string)($p['category'] ?? '');
            if ($catId === '' || !isset($known[$catId])) continue;
            $byCat[$catId][] = [
                'id'            => (string)($p['id'] ?? ''),
                'title'         => (string)($p['title'] ?? ''),
                'price'         => (float)($p['price'] ?? 0),
                'discountPrice' => (isset($p['discountPrice']) && $p['discountPrice'] !== null && $p['discountPrice'] !== '')
                                    ? (float)$p['discountPrice'] : null,
                'stock'         => (int)($p['stock'] ?? 0),
                'colors'        => is_array($p['colors'] ?? null) ? array_values($p['colors']) : [],
                'sizes'         => is_array($p['sizes'] ?? null) ? array_values($p['sizes']) : [],
                'tags'          => is_array($p['tags'] ?? null) ? array_values($p['tags']) : [],
                'description'   => (string)($p['description'] ?? ''),
                'images'        => is_array($p['images'] ?? null) ? array_values($p['images']) : []
            ];
            $kept++;
        }
        if (!$kept) {
            out(['ok'=>false,'message'=>'No product matched a known category — nothing was written'], 400);
        }
        foreach ($catRows as $c) { if (!isset($byCat[$c['id']])) $byCat[$c['id']] = []; }

        $version = date('Y-m-d') . '-admin-' . time();
        $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
        $text = "// ============================================================\n"
              . "// NOFRAME CATALOG DATA - GENERATED BY THE ADMIN PANEL\n"
              . "// Written by api.php?action=export_catalog on " . date('Y-m-d H:i') . "\n"
              . "// Edit products in the admin panel (Products tab), then press\n"
              . "// \"Update data/catalog.js\" — edit this file by hand only if you\n"
              . "// know the admin will overwrite it again.\n"
              . "// ============================================================\n\n"
              . "const CATALOG_VERSION = '" . $version . "';\n\n"
              . "const STORE_CATEGORIES = " . json_encode($catRows, $flags) . ";\n\n"
              . "const STORE_PRODUCTS = " . json_encode($byCat, $flags) . ";\n";

        $path = dirname(__DIR__) . '/data/catalog.js';
        if (is_file($path)) { @copy($path, dirname(__DIR__) . '/data/catalog.js.bak'); }
        if (@file_put_contents($path, $text) === false) {
            out(['ok'=>false,'message'=>'Could not write data/catalog.js — check the folder permissions'], 500);
        }

        out(['ok'=>true, 'version'=>$version, 'products'=>$kept, 'file'=>'data/catalog.js']);
    }

    /* --- ORDER PERSISTENCE (available to customers and guests) --- */
    if ($action === 'create_order') {
        $authUser = getAuthenticatedUser($pdo);
        $o = bodyJson();

        $orderId = trim($o['id'] ?? '');
        $items = is_array($o['items'] ?? null) ? $o['items'] : [];
        if ($orderId === '' || !$items) {
            out(['ok'=>false,'success'=>false,'message'=>'Order id and items are required'], 400);
        }

        // Ownership: the order belongs to the authenticated account, otherwise
        // it is stored as a guest order (user_id NULL) — never to a client-
        // supplied id, so nobody can attach orders to someone else's account.
        $userId = $authUser ? $authUser['id'] : null;
        $subtotal = (float)($o['subtotal'] ?? 0);
        $delivery = (float)($o['delivery'] ?? 0);
        $total = (float)($o['total'] ?? 0);
        $status = (string)($o['status'] ?? 'Pending');
        $shipping = json_encode($o['shipping'] ?? [], JSON_UNESCAPED_UNICODE);
        $createdAt = (int)($o['createdAt'] ?? round(microtime(true) * 1000));

        // A return request (customer-initiated from their order history) is
        // stored on the same row, so the reason and note survive a reload.
        $withReturn = returnColumnReady($pdo);
        $retReq = isset($o['returnRequest']) && is_array($o['returnRequest']) ? $o['returnRequest'] : null;
        $retJson = $retReq === null ? null : json_encode($retReq, JSON_UNESCAPED_UNICODE);
        $withPay = paymentColumnReady($pdo);
        $payReq = isset($o['payment']) && is_array($o['payment']) && $o['payment'] ? $o['payment'] : null;
        $payJson = $payReq === null ? null : json_encode($payReq, JSON_UNESCAPED_UNICODE);

        $stmt = $pdo->prepare("INSERT INTO orders(id,user_id,items,subtotal,delivery,total,status,shipping,created_at" . ($withReturn ? ",return_request" : "") . ($withPay ? ",payment" : "") . ")
                               VALUES(?,?,?,?,?,?,?,?," . ($withReturn ? "?" : "") . ($withPay ? "?" : "") . ")
                               ON DUPLICATE KEY UPDATE status=VALUES(status)" . ($withReturn ? ", return_request=VALUES(return_request)" : "") . ($withPay ? ", payment=VALUES(payment)" : ""));
        $args = [$orderId, $userId, json_encode($items, JSON_UNESCAPED_UNICODE),
            $subtotal, $delivery, $total, $status, $shipping, $createdAt];
        if ($withReturn) $args[] = $retJson;
        if ($withPay) $args[] = $payJson;
        $stmt->execute($args);

        out(['ok'=>true,'success'=>true,'orderId'=>$orderId,'userId'=>$userId]);
    }

    out(['ok'=>false,'message'=>'Unknown action'], 400);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    out(['ok'=>false,'message'=>$e->getMessage()], 500);
}
