from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mtd_api_key: str
    mtd_api_base: str = "https://api.mtd.dev"
    supabase_url: str
    supabase_service_role_key: str
    cors_origins: list[str] = ["http://localhost:3000"]
    gtfs_feed_url: str = "https://mtd.dev/gtfs.zip"
    gtfs_refresh_interval_hours: int = 6
    gtfs_rt_feed_url: str = "https://gtfs-rt.mtd.org/"

    class Config:
        env_file = ".env"


settings = Settings()
