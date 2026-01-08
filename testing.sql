SELECT * from hotels;

select * from users;
CREATE TABLE "housekeeping_orders" (
    "id" int NOT NULL AUTO_INCREMENT,
    "order_name" varchar(255) NOT NULL,
    "order_notes" text,
    "sent_by" int NOT NULL,
    "assigned_to" int DEFAULT NULL,
    "created_at" datetime DEFAULT CURRENT_TIMESTAMP,
    "completed_at" datetime DEFAULT NULL,
    "deleted_at" datetime DEFAULT NULL,
    "hotel_code" varchar(50) NOT NULL,
    PRIMARY KEY ("id"),
    KEY "sent_by" ("sent_by"),
    KEY "assigned_to" ("assigned_to"),
    CONSTRAINT "housekeeping_orders_ibfk_1" FOREIGN KEY ("sent_by") REFERENCES "users" ("id"),
    CONSTRAINT "housekeeping_orders_ibfk_2" FOREIGN KEY ("assigned_to") REFERENCES "users" ("id")
)

CREATE TABLE "hotels" (
    "id" varchar(50) NOT NULL,
    "code" varchar(50) NOT NULL,
    "name" varchar(100) NOT NULL,
    "createdAt" datetime DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    UNIQUE KEY "code" ("code")
);

CREATE TABLE "users" (
    "id" int NOT NULL AUTO_INCREMENT,
    "username" varchar(50) NOT NULL,
    "passwordHash" varchar(255) NOT NULL,
    "hotel_code" varchar(50) NOT NULL,
    "role" varchar(20) DEFAULT 'employee',
    "first_name" varchar(100) DEFAULT NULL,
    "last_name" varchar(100) DEFAULT NULL,
    "createdAt" datetime DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    UNIQUE KEY "username" ("username"),
    KEY "hotel_code" ("hotel_code"),
    CONSTRAINT "users_ibfk_1" FOREIGN KEY ("hotel_code") REFERENCES "hotels" ("code")
);

-- Insert sample hotels
INSERT INTO
    hotels (id, code, name)
VALUES (
        '2',
        'HOTEL002',
        'Grand Plaza Hotel'
    );

INSERT INTO
    users (
        username,
        passwordHash,
        hotel_code,
        role,
        first_name,
        last_name
    )
VALUES (
        'manager',
        'password123',
        'HOTEL002',
        'manager',
        'System',
        'Admin'
    );