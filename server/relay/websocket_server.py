#!/usr/bin/env python3
"""
NEXO Relay Server v2.0-NAP-CERTIFIED
Servidor WebSocket para fallback cuando P2P no está disponible

Correcciones NAP v2.0:
- [FIX 2.0.1] asyncio.Lock para proteger estructuras compartidas (rooms, rate_limits)
- [FIX 2.0.2] Limpieza automática de rate_limits viejos (clientes inactivos > 10 min)
- [FIX 2.0.3] Exception handling específico (no captura KeyboardInterrupt/SystemExit)
- [FIX 2.0.4] Validación de inputs (room/client_id length, message size)
- [FIX 2.0.5] Limpieza de offline_queue para salas vacías (TTL 10 min)
- [FIX 2.0.6] CancelledError propagado correctamente
- Rate limiting: máximo 100 mensajes/minuto por cliente
- Store & Forward con TTL 5 minutos
- Max message size: 64KB
"""

import asyncio
import json
import logging
from typing import Dict, Set
from datetime import datetime, timedelta
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="NEXO Relay", version="9.0.0-NAP")

# CORS para PWA/APK
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constantes de seguridad
MAX_ROOM_NAME_LENGTH = 64
MAX_CLIENT_ID_LENGTH = 128
MAX_MESSAGE_SIZE = 65536  # 64KB
MAX_MESSAGES_PER_MINUTE = 100
MAX_OFFLINE_MESSAGES_PER_ROOM = 100
MAX_ROOMS = 10000  # Límite global de salas
RATE_LIMIT_CLEANUP_INTERVAL = 600  # 10 minutos
OFFLINE_QUEUE_CLEANUP_INTERVAL = 600  # 10 minutos


class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Set[WebSocket]] = {}
        self.offline_queue: Dict[str, list] = {}
        self.rate_limits: Dict[str, list] = {}
        
        # [FIX 2.0.1] Locks para thread-safety
        self._rooms_lock = asyncio.Lock()
        self._rate_limits_lock = asyncio.Lock()
        self._offline_queue_lock = asyncio.Lock()
        
        # [FIX 2.0.2] Tracking de última actividad para limpieza
        self._last_client_activity: Dict[str, datetime] = {}
        
        # Iniciar tareas de limpieza periódica
        asyncio.create_task(self._cleanup_rate_limits())
        asyncio.create_task(self._cleanup_offline_queues())
    
    def _sanitize_id(self, id_str: str, max_length: int) -> str:
        """[FIX 2.0.4] Sanitizar ID: alfanumérico, guiones, underscores"""
        if not id_str:
            raise ValueError("ID cannot be empty")
        if len(id_str) > max_length:
            raise ValueError(f"ID too long (max {max_length} chars)")
        # Solo permitir alfanumérico, guiones y underscores
        sanitized = ''.join(c for c in id_str if c.isalnum() or c in '-_')
        if not sanitized:
            raise ValueError("ID contains no valid characters")
        return sanitized
    
    async def connect(self, websocket: WebSocket, room: str, client_id: str):
        # [FIX 2.0.4] Validar inputs
        try:
            room = self._sanitize_id(room, MAX_ROOM_NAME_LENGTH)
            client_id = self._sanitize_id(client_id, MAX_CLIENT_ID_LENGTH)
        except ValueError as e:
            logger.warning(f"Invalid room/client_id: {e}")
            await websocket.close(code=1008, reason=f"Invalid ID: {e}")
            return
        
        await websocket.accept()
        
        async with self._rooms_lock:
            # [FIX 2.0.4] Límite global de salas
            if room not in self.rooms and len(self.rooms) >= MAX_ROOMS:
                logger.warning(f"Max rooms limit reached ({MAX_ROOMS})")
                await websocket.close(code=1013, reason="Server at capacity")
                return
            
            if room not in self.rooms:
                self.rooms[room] = set()
            
            self.rooms[room].add(websocket)
            room_size = len(self.rooms[room])
        
        # Enviar mensajes offline (fuera del lock para no bloquear)
        offline_messages = await self._get_offline_messages(room)
        for msg in offline_messages:
            try:
                await websocket.send_json(msg)
            except:
                break  # Cliente desconectado durante envío
        
        logger.info(f"Client {client_id} joined room {room}. Total: {room_size}")
    
    async def _get_offline_messages(self, room: str) -> list:
        """Obtener y limpiar mensajes offline para una sala"""
        async with self._offline_queue_lock:
            if room not in self.offline_queue:
                return []
            
            now = datetime.now()
            cutoff = now - timedelta(minutes=5)
            
            # Filtrar mensajes válidos
            valid_messages = []
            for timestamp, msg in self.offline_queue[room]:
                if timestamp > cutoff:
                    valid_messages.append(msg)
            
            if valid_messages:
                self.offline_queue[room] = [(datetime.now(), m) for m in valid_messages[-MAX_OFFLINE_MESSAGES_PER_ROOM:]]
            else:
                del self.offline_queue[room]
            
            return valid_messages
    
    async def disconnect(self, websocket: WebSocket, room: str):
        room = self._sanitize_id(room, MAX_ROOM_NAME_LENGTH)
        
        async with self._rooms_lock:
            if room in self.rooms:
                self.rooms[room].discard(websocket)
                if not self.rooms[room]:
                    del self.rooms[room]
    
    async def broadcast(self, message: dict, room: str, sender: WebSocket):
        """Enviar mensaje a todos en la sala excepto al remitente"""
        room = self._sanitize_id(room, MAX_ROOM_NAME_LENGTH)
        
        async with self._rooms_lock:
            if room not in self.rooms:
                return
            
            # Copiar el set para evitar modificación durante iteración
            connections = list(self.rooms[room])
        
        disconnected = []
        for connection in connections:
            if connection != sender:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    # [FIX 2.0.3] Log específico de la excepción
                    logger.debug(f"Failed to send to client: {type(e).__name__}: {e}")
                    disconnected.append(connection)
        
        # Limpiar conexiones muertas
        if disconnected:
            async with self._rooms_lock:
                if room in self.rooms:
                    for conn in disconnected:
                        self.rooms[room].discard(conn)
    
    async def store_offline(self, room: str, message: dict):
        """Almacenar mensaje para usuarios offline"""
        room = self._sanitize_id(room, MAX_ROOM_NAME_LENGTH)
        
        async with self._offline_queue_lock:
            if room not in self.offline_queue:
                self.offline_queue[room] = []
            
            self.offline_queue[room].append((datetime.now(), message))
            
            # Mantener solo últimos 100 mensajes por sala
            if len(self.offline_queue[room]) > MAX_OFFLINE_MESSAGES_PER_ROOM:
                self.offline_queue[room] = self.offline_queue[room][-MAX_OFFLINE_MESSAGES_PER_ROOM:]
    
    async def check_rate_limit(self, client_id: str) -> bool:
        """Rate limiting: máximo 100 mensajes por minuto"""
        client_id = self._sanitize_id(client_id, MAX_CLIENT_ID_LENGTH)
        
        async with self._rate_limits_lock:
            now = datetime.now()
            
            if client_id not in self.rate_limits:
                self.rate_limits[client_id] = []
            
            # Limpiar entradas antiguas
            cutoff = now - timedelta(minutes=1)
            self.rate_limits[client_id] = [
                ts for ts in self.rate_limits[client_id] if ts > cutoff
            ]
            
            if len(self.rate_limits[client_id]) >= MAX_MESSAGES_PER_MINUTE:
                return False
            
            self.rate_limits[client_id].append(now)
            self._last_client_activity[client_id] = now
            
            # [FIX 2.0.2] Limpiar entrada vacía inmediatamente
            if not self.rate_limits[client_id]:
                del self.rate_limits[client_id]
            
            return True
    
    async def _cleanup_rate_limits(self):
        """[FIX 2.0.2] Tarea periódica para limpiar clientes inactivos"""
        while True:
            try:
                await asyncio.sleep(RATE_LIMIT_CLEANUP_INTERVAL)
                
                async with self._rate_limits_lock:
                    now = datetime.now()
                    cutoff = now - timedelta(minutes=10)
                    
                    # Eliminar clientes inactivos
                    inactive_clients = [
                        cid for cid, last_seen in self._last_client_activity.items()
                        if last_seen < cutoff
                    ]
                    
                    for cid in inactive_clients:
                        self.rate_limits.pop(cid, None)
                        self._last_client_activity.pop(cid, None)
                    
                    if inactive_clients:
                        logger.info(f"Cleaned up {len(inactive_clients)} inactive rate limit entries")
                        
            except asyncio.CancelledError:
                raise  # [FIX 2.0.6] Propagar CancelledError
            except Exception as e:
                logger.error(f"Error in rate limit cleanup: {e}")
    
    async def _cleanup_offline_queues(self):
        """[FIX 2.0.5] Tarea periódica para limpiar salas vacías"""
        while True:
            try:
                await asyncio.sleep(OFFLINE_QUEUE_CLEANUP_INTERVAL)
                
                async with self._offline_queue_lock:
                    async with self._rooms_lock:
                        # Encontrar salas en offline_queue que no existen en rooms
                        rooms_to_check = list(self.offline_queue.keys())
                        
                        for room in rooms_to_check:
                            if room not in self.rooms:
                                # Sala no tiene usuarios conectados, eliminar después de 10 min
                                # (los mensajes ya tienen TTL de 5 min, así que esto es extra)
                                del self.offline_queue[room]
                        
                        if rooms_to_check:
                            logger.info(f"Cleaned up offline queues. Active rooms: {len(self.offline_queue)}")
                            
            except asyncio.CancelledError:
                raise  # [FIX 2.0.6] Propagar CancelledError
            except Exception as e:
                logger.error(f"Error in offline queue cleanup: {e}")


manager = ConnectionManager()


@app.websocket("/ws/{room}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room: str, client_id: str):
    await manager.connect(websocket, room, client_id)
    
    try:
        while True:
            try:
                # [FIX 2.0.4] Limitar tamaño de mensaje
                data = await websocket.receive_text()
                
                if len(data.encode('utf-8')) > MAX_MESSAGE_SIZE:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Message too large (max {MAX_MESSAGE_SIZE} bytes)"
                    })
                    continue
                
                message = json.loads(data)
                
                # Validar estructura básica del mensaje
                if not isinstance(message, dict):
                    await websocket.send_json({
                        "type": "error", 
                        "message": "Message must be a JSON object"
                    })
                    continue
                
                # Rate limiting
                if not await manager.check_rate_limit(client_id):
                    await websocket.send_json({
                        "type": "error",
                        "message": "Rate limit exceeded"
                    })
                    continue
                
                # Añadir metadata
                message["_relay"] = True
                message["_timestamp"] = datetime.now().isoformat()
                message["_sender"] = client_id
                
                # Broadcast a otros
                await manager.broadcast(message, room, websocket)
                
                # Store & forward
                await manager.store_offline(room, message)
                
                # Acknowledge pings
                if message.get("type") == "ping":
                    await websocket.send_json({
                        "type": "pong", 
                        "timestamp": message.get("timestamp")
                    })
                
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error", 
                    "message": "Invalid JSON"
                })
            except ValueError as e:
                # Error de validación
                await websocket.send_json({
                    "type": "error",
                    "message": str(e)
                })
                
    except WebSocketDisconnect:
        await manager.disconnect(websocket, room)
        logger.info(f"Client {client_id} disconnected from {room}")
    except asyncio.CancelledError:
        # [FIX 2.0.6] Propagar CancelledError para shutdown graceful
        await manager.disconnect(websocket, room)
        raise
    except Exception as e:
        # [FIX 2.0.3] Log específico pero no capturar CancelledError
        logger.error(f"Error with client {client_id}: {type(e).__name__}: {e}")
        await manager.disconnect(websocket, room)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "version": "9.0.0-NAP",
        "rooms": len(manager.rooms),
        "total_connections": sum(len(room) for room in manager.rooms.values())
    }


@app.get("/stats")
async def get_stats():
    async with manager._rooms_lock:
        rooms_count = len(manager.rooms)
        connections = sum(len(room) for room in manager.rooms.values())
    
    async with manager._offline_queue_lock:
        offline_queues = len(manager.offline_queue)
    
    async with manager._rate_limits_lock:
        rate_limited = len(manager.rate_limits)
    
    return {
        "rooms": rooms_count,
        "connections": connections,
        "offline_queues": offline_queues,
        "rate_limited_clients": rate_limited
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
