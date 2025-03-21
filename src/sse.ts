// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import {
  ForecastDay,
  OpenWeatherResponse,
  isValidForecastArgs,
} from "./types/weather.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from 'express'
const app = express()

const API_KEY = '7f07c91f0fbb521e3c6ee0c00b184fc4'
if (!API_KEY) {
  throw new Error("OPENWEATHER_API_KEY environment variable is required");
}

const API_CONFIG = {
  BASE_URL: "http://api.openweathermap.org/data/2.5",
  DEFAULT_CITY: "San Francisco",
  ENDPOINTS: {
    CURRENT: "weather",
    FORECAST: "forecast",
  },
} as const;

class WeatherServer {
  private server: Server;
  private axiosInstance;
  transport: any

  constructor() {
    this.server = new Server(
      {
        name: "weather-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // 配置 axios 实例
    this.axiosInstance = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      params: {
        appid: API_KEY,
        units: "metric",
      },
    });

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.setupResourceHandlers();
    this.setupToolHandlers();
  }

  private setupResourceHandlers(): void {
    this.server.setRequestHandler(
      ListResourcesRequestSchema,
      async () => {
        try {
          return {
            resources: [{
              uri: `personal://tom/current`,
              name: `user name`,
              mimeType: "application/json",
              description: "get user‘s name、age"
            }]
          }
        } catch (error) {
          return {}
        }
      }
    );

    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const user = 'tom';
        if (request.params.uri !== `personal://${user}/current`) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource: ${request.params.uri}`
          );
        }

        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify({
              name: user,
              age: 18
            }, null, 2)
          }]
        }

        //   try {
        //     const response = await this.axiosInstance.get<OpenWeatherResponse>(
        //       API_CONFIG.ENDPOINTS.CURRENT,
        //       {
        //         params: { q: city }
        //       }
        //     );

        //     const weatherData: WeatherData = {
        //       temperature: response.data.main.temp,
        //       conditions: response.data.weather[0].description,
        //       humidity: response.data.main.humidity,
        //       wind_speed: response.data.wind.speed,
        //       timestamp: new Date().toISOString()
        //     };

        //     return {
        //       contents: [{
        //         uri: request.params.uri,
        //         mimeType: "application/json",
        //         text: JSON.stringify(weatherData, null, 2)
        //       }]
        //     };
        //   } catch (error) {
        //     if (axios.isAxiosError(error)) {
        //       throw new McpError(
        //         ErrorCode.InternalError,
        //         `Weather API error: ${error.response?.data.message ?? error.message}`
        //       );
        //     }
        //     throw error;
        //   }
      }
    );
  }

  private setupToolHandlers(): void {

    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => ({
        tools: [{
          name: "get_forecast",
          description: "Get weather forecast for a city",
          inputSchema: {
            type: "object",
            properties: {
              city: {
                type: "string",
                description: "City name"
              },
              days: {
                type: "number",
                description: "Number of days (1-5)",
                minimum: 1,
                maximum: 5
              }
            },
            required: ["city"]
          }
        }]
      })
    );

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        try {
          if (request.params.name !== "get_forecast") {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
          }

          if (!isValidForecastArgs(request.params.arguments)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              "Invalid forecast arguments"
            );
          }
        } catch (err) { }
        // return {
        //   content: [{
        //     type: "img",
        //     url: "https://avatars.githubusercontent.com/u/22317929?v=4&s=64"
        //   }]
        // }

        // @ts-ignore
        const city = request.params.arguments.city;
        // @ts-ignore
        const days = Math.min(request.params.arguments.days || 3, 5);

        try {
          const response = await this.axiosInstance.get<{
            list: OpenWeatherResponse[]
          }>(API_CONFIG.ENDPOINTS.FORECAST, {
            params: {
              q: city,
              cnt: days * 8 // API 返回 3 小时间隔的数据
            }
          });

          const forecasts: ForecastDay[] = [];
          for (let i = 0; i < response.data.list.length; i += 8) {
            const dayData = response.data.list[i];
            forecasts.push({
              date: dayData.dt_txt?.split(' ')[0] ?? new Date().toISOString().split('T')[0],
              temperature: dayData.main.temp,
              conditions: dayData.weather[0].description
            });
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify(forecasts, null, 2)
            }]
          };
        } catch (error) {
          if (axios.isAxiosError(error)) {
            return {
              content: [{
                type: "text",
                // @ts-ignore
                text: `Weather API error: ${error.response?.data.message ?? error.message}`
              }],
              isError: true,
            }
          }
          throw error;
        }
      }
    );
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error("Weather MCP server running on stdio");
  }

  async runSSE(res: any): Promise<void> {
    this.transport = new SSEServerTransport("/messages", res);
    await this.server.connect(this.transport);
  }
}

const server = new WeatherServer();

app.get("/sse", async (req, res) => {
  console.log(`New SSE connection from ${req.ip}`);
  await server.runSSE(res);
});

app.post("/messages", async (req, res) => {
  // Note: to support multiple simultaneous connections, these messages will
  // need to be routed to a specific matching transport. (This logic isn't
  // implemented here, for simplicity.)
  await server.transport.handlePostMessage(req, res);
});

app.listen(3001);