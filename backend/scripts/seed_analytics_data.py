
from datetime import timedelta
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from collections import defaultdict
import random

import jdatetime
from sqlalchemy import select, func

from app.database import SessionLocal
from app.models import User, Category, Transaction


# ==========================================
# FINOVA ANALYTICS TEST DATA GENERATOR
# ==========================================

USER_ID = 1
TOTAL_EXPENSES = 1356
TOTAL_INCOMES = 144
MARKER = "[[FINOVA_ANALYTICS_TEST_V1]]"

random.seed(20261124)

db = SessionLocal()

EXPENSE_CATEGORIES = {
    "خوراک و مواد غذایی": (250_000, 1_800_000),
    "حمل‌ونقل": (80_000, 600_000),
    "خرید و پوشاک": (500_000, 4_000_000),
    "آموزش": (300_000, 2_500_000),
    "درمان و سلامت": (200_000, 3_000_000),
    "سایر هزینه‌ها": (150_000, 2_000_000),
    "سرگرمی": (200_000, 1_500_000),
    "مسکن و قبوض": (1_500_000, 6_000_000),
}

INCOME_CATEGORIES = {
    "حقوق و دستمزد": (30_000_000, 55_000_000),
    "درآمد فریلنسری": (2_000_000, 8_000_000),
    "سایر درآمدها": (500_000, 4_000_000),
    "سرمایه‌گذاری": (1_000_000, 5_000_000),
    "فروش": (1_000_000, 6_000_000),
    "هدیه": (500_000, 3_000_000),
    "پاداش": (1_000_000, 5_000_000),
}

EXPENSE_TITLES = {
    "خوراک و مواد غذایی": ["خرید مواد غذایی", "خرید روزانه", "سوپرمارکت"],
    "حمل‌ونقل": ["هزینه تاکسی", "بنزین", "حمل‌ونقل شهری"],
    "خرید و پوشاک": ["خرید لباس", "خرید لوازم شخصی", "خرید آنلاین"],
    "آموزش": ["خرید کتاب", "دوره آموزشی", "هزینه آموزش"],
    "درمان و سلامت": ["دارو و درمان", "ویزیت پزشک", "هزینه سلامت"],
    "سایر هزینه‌ها": ["هزینه متفرقه", "خدمات شخصی", "پرداخت متفرقه"],
    "سرگرمی": ["رستوران و تفریح", "سینما", "فعالیت تفریحی"],
    "مسکن و قبوض": ["پرداخت قبض", "هزینه خانه", "قبوض ماهانه"],
}

INCOME_TITLES = {
    "حقوق و دستمزد": ["دریافت حقوق ماهانه"],
    "درآمد فریلنسری": ["پروژه فریلنسری", "دریافت دستمزد پروژه"],
    "سایر درآمدها": ["درآمد متفرقه"],
    "سرمایه‌گذاری": ["سود سرمایه‌گذاری"],
    "فروش": ["درآمد فروش"],
    "هدیه": ["دریافت هدیه"],
    "پاداش": ["دریافت پاداش"],
}

try:
    # 1. Check target user
    user = db.get(User, USER_ID)

    if user is None:
        raise RuntimeError(f"User ID {USER_ID} does not exist.")

    # 2. Prevent duplicate insertion
    existing = db.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.user_id == USER_ID,
            Transaction.description.contains(MARKER)
        )
    )

    if existing:
        raise RuntimeError(
            f"Found {existing} generated records. "
            "No new records were inserted."
        )

    # 3. Load only this user's categories
    categories = db.scalars(
        select(Category).where(Category.user_id == USER_ID)
    ).all()

    category_map = {
        (category.name, category.type): category.id
        for category in categories
    }

    for name in EXPENSE_CATEGORIES:
        if (name, "expense") not in category_map:
            raise RuntimeError(f"Missing expense category: {name}")

    for name in INCOME_CATEGORIES:
        if (name, "income") not in category_map:
            raise RuntimeError(f"Missing income category: {name}")

    # 4. Generate 36 completed Jalali months
    transactions = []

    basket_pairs = [
        ("خوراک و مواد غذایی", "حمل‌ونقل"),
        ("خوراک و مواد غذایی", "خرید و پوشاک"),
        ("سرگرمی", "خوراک و مواد غذایی"),
        ("درمان و سلامت", "حمل‌ونقل"),
        ("خرید و پوشاک", "حمل‌ونقل"),
        ("آموزش", "خوراک و مواد غذایی"),
    ]

    month_index = 0

    for year in range(1402, 1406):
        for month in range(1, 13):

            if year == 1402 and month < 8:
                continue

            if year == 1405 and month > 7:
                continue

            jalali_start = jdatetime.date(year, month, 1)

            if month == 12:
                next_year, next_month = year + 1, 1
            else:
                next_year, next_month = year, month + 1

            gregorian_start = jalali_start.togregorian()
            gregorian_end = jdatetime.date(
                next_year, next_month, 1
            ).togregorian()

            days_in_month = (gregorian_end - gregorian_start).days

            # Monthly spending variation
            monthly_factor = [
                0.85, 1.00, 1.20, 0.92,
                1.15, 0.80, 1.08, 1.25,
                0.90, 1.12, 0.95, 1.18
            ][month_index % 12]

            # Exactly 1356 expenses across 36 months
            expense_count = 38 if month_index < 24 else 37

            # Recurring expense baskets for Apriori
            for pair_index in range(9):
                pair = basket_pairs[
                    (pair_index + month_index) % len(basket_pairs)
                ]

                day = random.randrange(days_in_month)
                tx_date = gregorian_start + timedelta(days=day)

                for category_name in pair:
                    low, high = EXPENSE_CATEGORIES[category_name]
                    amount = int(
                        random.randint(low, high) * monthly_factor
                    )

                    transactions.append(
                        Transaction(
                            user_id=USER_ID,
                            category_id=category_map[
                                (category_name, "expense")
                            ],
                            type="expense",
                            title=random.choice(
                                EXPENSE_TITLES[category_name]
                            ),
                            amount=max(1, amount),
                            transaction_date=tx_date,
                            payment_method=random.choice(
                                ["card", "cash", "online"]
                            ),
                            description=MARKER
                        )
                    )

            # Remaining expenses
            remaining = expense_count - 18

            for _ in range(remaining):
                category_name = random.choices(
                    list(EXPENSE_CATEGORIES.keys()),
                    weights=[30, 18, 12, 7, 6, 10, 9, 8],
                    k=1
                )[0]

                low, high = EXPENSE_CATEGORIES[category_name]
                amount = int(
                    random.randint(low, high) * monthly_factor
                )

                day = random.randrange(days_in_month)
                tx_date = gregorian_start + timedelta(days=day)

                transactions.append(
                    Transaction(
                        user_id=USER_ID,
                        category_id=category_map[
                            (category_name, "expense")
                        ],
                        type="expense",
                        title=random.choice(
                            EXPENSE_TITLES[category_name]
                        ),
                        amount=max(1, amount),
                        transaction_date=tx_date,
                        payment_method=random.choice(
                            ["card", "cash", "online"]
                        ),
                        description=MARKER
                    )
                )

            # Four incomes per month, including monthly salary
            income_names = [
                "حقوق و دستمزد",
                "درآمد فریلنسری",
                random.choice(["سرمایه‌گذاری", "فروش"]),
                random.choice(["سایر درآمدها", "هدیه", "پاداش"]),
            ]

            for income_index, category_name in enumerate(income_names):
                low, high = INCOME_CATEGORIES[category_name]
                amount = random.randint(low, high)

                if income_index == 0:
                    day = random.randint(0, min(4, days_in_month - 1))
                else:
                    day = random.randrange(days_in_month)

                tx_date = gregorian_start + timedelta(days=day)

                transactions.append(
                    Transaction(
                        user_id=USER_ID,
                        category_id=category_map[
                            (category_name, "income")
                        ],
                        type="income",
                        title=random.choice(
                            INCOME_TITLES[category_name]
                        ),
                        amount=amount,
                        transaction_date=tx_date,
                        payment_method="bank",
                        description=MARKER
                    )
                )

            month_index += 1

    # 5. Verify generated dataset before insertion
    expense_total = sum(
        tx.type == "expense" for tx in transactions
    )
    income_total = sum(
        tx.type == "income" for tx in transactions
    )

    print("\n========== DATASET PREVIEW ==========")
    print(f"Target User ID: {USER_ID}")
    print(f"Total transactions: {len(transactions)}")
    print(f"Expenses: {expense_total}")
    print(f"Incomes: {income_total}")
    print("Period: 1402/08 through 1405/07")
    print("Original transactions will NOT be modified.")

    if len(transactions) != 1500:
        raise RuntimeError("Unexpected transaction count.")

    confirmation = input(
        "\nTo insert these records, type ADD: "
    )

    if confirmation.strip() != "ADD":
        print("Cancelled. Database was not changed.")
    else:
        db.add_all(transactions)
        db.commit()

        print("\nSUCCESS!")
        print(f"Inserted: {len(transactions)} transactions")
        print(f"User ID: {USER_ID}")
        print(f"Marker: {MARKER}")

except Exception:
    db.rollback()
    raise

finally:
    db.close()
