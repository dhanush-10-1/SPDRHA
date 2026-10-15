from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db.connection import connect, disconnect
from backend.kafka.producer import start_producer, stop_producer

from backend.routers.anomalies import router as anomalies_router
from backend.routers.health import router as health_router
from backend.routers.dev_auth import router as dev_auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect()
    await start_producer()

    yield

    # Shutdown
    await stop_producer()
    await disconnect()


app = FastAPI(
    title="IRADS Backend",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration for local Expo Web development
# CORS configuration for local Expo Web development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:8082",
        "http://127.0.0.1:8082",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(health_router)
app.include_router(anomalies_router)
app.include_router(dev_auth_router)


@app.get("/")
async def root():
    return {"message": "IRADS backend is running"}