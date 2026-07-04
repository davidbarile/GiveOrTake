import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { IdentityService } from '../identity/identity.service';

@WebSocketGateway({ cors: { origin: '*', credentials: true }, namespace: '/ws' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(private readonly identity: IdentityService) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token || client.handshake.headers?.cookie
      ?.split(';').find((c: string) => c.trim().startsWith('got_session='))
      ?.split('=')[1];

    if (!token) { client.disconnect(); return; }
    const playerId = await this.identity.resolveSession(token);
    if (!playerId) { client.disconnect(); return; }

    client.data.playerId = playerId;
    client.emit('connected', { playerId });
  }

  handleDisconnect(client: Socket) {
    // Leave all rooms automatically (socket.io handles it)
  }

  @SubscribeMessage('pod.subscribe')
  async subscribeToPod(@ConnectedSocket() client: Socket, @MessageBody() data: { podId: string }) {
    await client.join(`pod:${data.podId}`);
    client.emit('pod.subscribed', { podId: data.podId });
  }

  @SubscribeMessage('pod.unsubscribe')
  async unsubscribeFromPod(@ConnectedSocket() client: Socket, @MessageBody() data: { podId: string }) {
    await client.leave(`pod:${data.podId}`);
  }

  // Emit helpers called by other services
  emitToPod(podId: string, event: string, data: unknown) {
    this.server.to(`pod:${podId}`).emit(event, data);
  }

  emitToPlayer(playerId: string, event: string, data: unknown) {
    this.server.to(`player:${playerId}`).emit(event, data);
  }
}
