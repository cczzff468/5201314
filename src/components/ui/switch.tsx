"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * iOS 系统风格大号开关（51×31，选中 #34C759 绿 + 绿色投影，白色圆形滑块带阴影）。
 * 全局统一（设置/闹钟/日历/提醒事项共用），对齐 moments-settings 的 BigGreenSwitch 视觉。
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[31px] w-[52px] shrink-0 items-center rounded-full px-[2px] outline-none transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95",
        "data-[state=checked]:bg-[#34C759] data-[state=checked]:shadow-[0_2px_8px_rgba(52,199,89,0.4)]",
        "data-[state=unchecked]:bg-black/15 dark:data-[state=unchecked]:bg-white/25",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.18),0_1px_1px_rgba(0,0,0,0.1)] transition-transform duration-200",
          "data-[state=checked]:translate-x-[19px] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
