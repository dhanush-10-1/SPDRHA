from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.db.connection import connect, disconnect
from backend.kafka.producer import start_producer, stop_producer
from backend.routers.anomalies import router as anomalies_router
from backend.routers.health import router as health_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    await start_producer()
    yield
    await stop_producer()
    await disconnect()


app = FastAPI(
    title="IRADS Backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(health_router)
app.include_router(anomalies_router)


@app.get("/")
async def root():
    return {"message": "IRADS backend is running"}
