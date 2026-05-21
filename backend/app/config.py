from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mtd_api_key: str
    mtd_api_base: str = "https://api.mtd.dev"
    supabase_url: str
    supabase_service_role_key: str
    cors_origins: list[str] = ["http://localhost:3000"]

    class Config:
        env_file = ".env"


settings = Settings()
