# Task 16-b：日历 App 珊瑚红暖色重构（11 页设计稿）

## 状态
- 进行中（前端专家代理 16-b）
- 范围：src/components/apps/calendar.tsx → src/components/apps/calendar/ 目录（多页拆分）、src/lib/ios/db.ts（仅加可选字段）

## 与备忘录 App（16-a 或其他代理）的字段约定（重要）
在 `src/lib/ios/db.ts` 的 `NoteRecord` 上新增两个**可选字段**（旧数据兼容）：

- `linkedEventId?: string` —— 该备忘录关联的日历日程 ID（CalendarEventRecord.id）
- `linkDate?: string` —— 该备忘录关联的日期，格式 `YYYY-MM-DD`

日历侧语义：
- 日程详情页「当日备忘录」= 备忘录中 `linkedEventId === 该日程id || linkDate === 该日程.date` 的笔记
- 「关联已有」选中某条备忘录 → 写入 `linkedEventId` + `linkDate`（每个日程只强关联一条，换选时旧条只清 `linkedEventId`，保留 `linkDate` 日期关联）
- 删除日程 → 只清 `linkedEventId`（保留 `linkDate` 与笔记本体，备忘录永远不删）
- 备忘录 App 若也要展示关联，请读这两个字段；请勿重命名字段，改名前先在 worklog 协商

## CalendarEventRecord 新增可选字段
- `location?: string` 地点
- `color?: string` 日程颜色 key（purple/blue/yellow/orange/teal/green/red/lime/olive/brown/pink，缺省 purple）
- `endDate?: string` 结束日期 YYYY-MM-DD（跨天日程，缺省=同 date）
- `repeatRule?: 'none'|'daily'|'weekly'|'monthly'|'yearly'`（缺省按旧 `repeat?: number[]` 数组推导）
- `alert?: 'none'|'atStart'|'m5'|'m15'|'m30'|'h1'|'d1'`（缺省 m15）

## 其他备忘
- 设计稿：upload/B7731BF14F57939DE303ACC84334D8CD_1792764236913.webp（11 页拼图，已切到 upload/cal-crop/）
- 主色 #E5493C，浅红胶囊底 #FBEAE7，暖白底 #FAF9F7，金色按钮 #C79A3B
- 禁改 notes.tsx / wechat.tsx / voice-bubble.tsx / music-* / CoupleHome.tsx / CalendarCard.tsx
