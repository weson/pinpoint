import { Injectable } from '@angular/core';
import { Subject, Observable, of, throwError, iif } from 'rxjs';
import { WebSocketSubject, WebSocketSubjectConfig } from 'rxjs/webSocket';
import { timeout, catchError, map, filter, tap, delay, concatMap } from 'rxjs/operators';

import { WindowRefService } from 'app/shared/services';

interface IWebSocketData {
    type: ResponseType;
    command: string;
    result: IWebSocketDataResult;
}

export interface IWebSocketDataResult {
    timeStamp: number;
    applicationName: string;
    activeThreadCounts: { [key: string]: IActiveThreadCounts };
}

export interface IActiveThreadCounts {
    code: number;
    message: string;
    status?: number[];
}

export interface IWebSocketResponse {
    type: string;
    message: string | IWebSocketDataResult;
}

export const enum ResponseType {
    PING = 'PING',
    RESPONSE = 'RESPONSE'
}

export const enum ResponseCode {
    SUCCESS = 0,
    TIMEOUT = 211,
    ERROR_BLACK = 111,
    OVER_DELAY = 9999
}

@Injectable()
export class NewRealTimeWebSocketService {
    private url = 'agent/activeThread.pinpointws';
    private delayLimit = 5000; // 서버로부터의 응답을 기다리는 최대시간(ms)
    private retryTimeout = 3000;
    private retryCount = 0;
    private maxRetryCount = 1;
    private connectTime: number;
    private isOpen = false;
    private pagingSize = 30;
    private socket$: WebSocketSubject<any> = null;
    private outMessage: Subject<IWebSocketResponse> = new Subject();

    onMessage$: Observable<IWebSocketResponse>;

    constructor(
        private windowRefService: WindowRefService
    ) {
        this.onMessage$ = this.outMessage.asObservable();
    }
    connect(): void {
        if (this.isOpen === false) {
            this.openWebSocket();
        }
    }
    isOpened(): boolean {
        return this.isOpen;
    }
    close(): void {
        if (this.isOpen) {
            this.socket$.complete();
        } else {
            this.outMessage.next({
                type: 'close',
                message: ''
            });
        }
    }
    send(message: object): void {
        if (this.isOpen) {
            this.socket$.next(message);
        }
    }
    getPagingSize(): number {
        return this.pagingSize;
    }
    private openWebSocket(): void {
        const location = this.windowRefService.nativeWindow.location;
        const protocol = location.protocol.indexOf('https') === -1 ? 'ws' : 'wss';
        const url = `${protocol}://${location.host}/${this.url}`;
        // let k = -1;
        // let t = 0;

        this.socket$ = new WebSocketSubject<any>({
            url: url,
            openObserver: {
                next: () => {
                    this.isOpen = true;
                    this.connectTime = Date.now();
                    this.outMessage.next({
                        type: 'open',
                        message: event.toString()
                    });
                }
            },
            closeObserver: {
                next: () => {
                    this.onCloseEvents();
                }
            }
        } as WebSocketSubjectConfig<any>);

        this.socket$.pipe(
            // concatMap((m: IWebSocketData) => {
            //     k++;
            //     return iif(() => k >= 2 && k < 6, of(m).pipe(delay(1000)), of(m).pipe(delay(0)));
            // }),
            filter((message: IWebSocketData) => {
                return message.type === ResponseType.PING ? (this.send({ type: 'PONG' }), false) : true;
            }),
            map(({result}: {result: IWebSocketDataResult}) => result),
            // map(({timeStamp, applicationName}) => {
            //     const activeThreadCounts = {};

            //     for (let i = 0; i < 12; i++) {
            //         activeThreadCounts[i] = {
            //             code: ResponseCode.SUCCESS,
            //             message: 'OK',
            //             status: [
            //                 Math.floor(3 * Math.random()),
            //                 Math.floor(3 * Math.random()),
            //                 Math.floor(3 * Math.random()),
            //                 Math.floor(3 * Math.random())
            //                 // 5, 5, 5, 5
            //             ]
            //         };
            //     }
            //     // for (let i = 0; i < 40; i++) {
            //     //     activeThreadCounts[i] = {
            //     //         code: ResponseCode.ERROR_BLACK,
            //     //         message: 'ERROR ERROR SUPERERROR',
            //     //     };
            //     // }
            //     return {
            //         timeStamp,
            //         applicationName,
            //         activeThreadCounts
            //     };
            // }),
            // tap(() => t++),
            // map((d: IWebSocketDataResult) => {
            //     const { timeStamp, applicationName, activeThreadCounts } = d;

            //     if (t % 3 === 0) {
            //         delete activeThreadCounts[t];

            //         return {
            //             timeStamp, applicationName, activeThreadCounts
            //         };
            //     }
            //     return d;
            // }),
            timeout(this.delayLimit),
            catchError((err: any) => err.name === 'TimeoutError' ? this.onTimeout() : throwError(err)),
            filter((message: IWebSocketDataResult | null) => {
                return !!message;
            }),
        ).subscribe((message: IWebSocketDataResult) => {
            this.outMessage.next({
                type: 'message',
                message
            });
        }, (err: any) => {
            console.log(err);
            this.closed();
        }, () => {
            console.log('Complete');
            this.closed();
        });
    }

    // TODO: No Response 메시지 띄워주기
    private onTimeout(): Observable<null> {
        this.close();

        return of(null);
    }

    private closed(): void {
        this.isOpen = false;
        this.socket$ = null;
        this.outMessage.next({
            type: 'close',
            message: ''
        });
    }

    private onCloseEvents(): void {
        if (Date.now() - this.connectTime < this.retryTimeout) {
            if (this.retryCount < this.maxRetryCount) {
                this.retryCount++;
                this.outMessage.next({
                    type: 'retry',
                    message: ''
                });
            } else {
                this.outMessage.next({
                    type: 'close',
                    message: ''
                });
            }
        }
    }
}