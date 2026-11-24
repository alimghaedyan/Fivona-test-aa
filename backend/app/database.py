# app/database.py

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker


# مسیر اصلی پوشه backend
BASE_DIR = Path(__file__).resolve().parent.parent

# پوشه ذخیره پایگاه داده
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# آدرس پایگاه داده SQLite
DATABASE_URL = f"sqlite:///{(DATA_DIR / 'darik.db').as_posix()}"

# ایجاد موتور اتصال
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


# فعال‌سازی کلیدهای خارجی در SQLite
@event.listens_for(engine, "connect")
def enable_sqlite_foreign_keys(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


# مدیریت نشست‌های دیتابیس
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)


# کلاس پایه مدل‌ها
class Base(DeclarativeBase):
    pass


# وابستگی برای استفاده در APIها
def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()

def run_security_migrations():
    """Small additive migration for existing local SQLite databases."""
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "users" in tables:
        columns = {column["name"] for column in inspector.get_columns("users")}
        if "token_version" not in columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"))

    if "transactions" in tables:
        columns = {column["name"] for column in inspector.get_columns("transactions")}
        if "updated_at" not in columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE transactions ADD COLUMN updated_at DATETIME"))
                connection.execute(text(
                    "UPDATE transactions SET updated_at = created_at WHERE updated_at IS NULL"
                ))

    # بودجه‌ها در نسخه اولیه با CHECK (year >= 2000) ساخته می‌شدند که با
    # سال‌های شمسی (۱۳۰۰ تا ۱۵۰۰) ناسازگار است. جدول را بدون از دست دادن
    # ردیف‌ها بازسازی می‌کنیم.
    if "budgets" in tables:
        # اگر بازسازی قبلی نیمه‌کاره مانده باشد، ردیف‌ها را برمی‌گردانیم.
        if "budgets_legacy" in tables:
            with engine.begin() as connection:
                connection.execute(text(
                    "INSERT OR IGNORE INTO budgets (id, user_id, category_id, year, month, amount) "
                    "SELECT id, user_id, category_id, year, month, amount FROM budgets_legacy"
                ))
                connection.execute(text("DROP TABLE budgets_legacy"))
        with engine.begin() as connection:
            row = connection.execute(text(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='budgets'"
            )).first()
            if row and row[0] and "year >= 2000" in row[0]:
                connection.execute(text("PRAGMA foreign_keys=OFF"))
                connection.execute(text("ALTER TABLE budgets RENAME TO budgets_legacy"))
                # ایندکس‌های جدول قدیمی با همان نام باقی می‌مانند و ساخت جدول
                # جدید را با خطای «ایندکس از قبل وجود دارد» متوقف می‌کنند.
                legacy_indexes = connection.execute(text(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='index' AND tbl_name='budgets_legacy' AND sql IS NOT NULL"
                )).fetchall()
                for (index_name,) in legacy_indexes:
                    connection.execute(text(f'DROP INDEX IF EXISTS "{index_name}"'))
                from app.models import Budget
                Budget.__table__.create(connection)
                connection.execute(text(
                    "INSERT INTO budgets (id, user_id, category_id, year, month, amount) "
                    "SELECT id, user_id, category_id, year, month, amount FROM budgets_legacy"
                ))
                connection.execute(text("DROP TABLE budgets_legacy"))
                connection.execute(text("PRAGMA foreign_keys=ON"))
