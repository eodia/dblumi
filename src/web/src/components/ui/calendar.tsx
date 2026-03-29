import "react-day-picker/style.css"
import { DayPicker } from "react-day-picker"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

function Calendar({
  className,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      className={cn("p-3 text-sm", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        button_previous:
          "absolute left-1 inline-flex items-center justify-center h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 border border-input rounded-md",
        button_next:
          "absolute right-1 inline-flex items-center justify-center h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 border border-input rounded-md",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "h-9 w-9 text-center text-sm p-0 relative rounded-md focus-within:relative focus-within:z-20",
        day_button:
          "inline-flex items-center justify-center h-9 w-9 p-0 font-normal rounded-md hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md",
        today: "bg-accent text-accent-foreground font-bold",
        outside: "text-muted-foreground/50 aria-selected:bg-accent/50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        chevron: "fill-foreground h-4 w-4",
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  )
}

export { Calendar }
